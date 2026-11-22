/* =========================================================
   OOT Street — online layer (Supabase): login, coins, leaderboard,
   receipt redeem, store vouchers. All coin rules live in the DB
   (supabase/schema.sql); this file only calls the game_* RPCs.
   ========================================================= */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';

// Public by design: the publishable key only reaches what RLS and the game_* functions allow.
export const SUPABASE_URL = 'https://rlgzaboxcwhocdizgddg.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_ievNNyEc4CE3fx1BTtvQkQ_adBubjQE';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'oot_street_auth' },
});

// Error codes raised by the SQL functions, shown to players in Bahasa Indonesia.
const MSG = {
  BELUM_LOGIN: 'Kamu belum login.',
  PROFIL_KOSONG: 'Lengkapi nama dan nomor HP dulu.',
  NOMOR_HP_SALAH: 'Nomor HP tidak valid. Contoh: 0812xxxxxxx',
  NOMOR_HP_DIPAKAI: 'Nomor HP ini sudah dipakai akun lain.',
  KODE_TIDAK_ADA: 'Kode nota tidak ditemukan. Cek lagi hurufnya.',
  KODE_SUDAH_DIPAKAI: 'Kode nota ini sudah pernah dipakai.',
  TERLALU_BANYAK_COBA: 'Terlalu banyak kode salah. Coba lagi 1 jam lagi.',
  PERIODE_SELESAI: 'Periode leaderboard sudah selesai.',
  KOIN_KURANG: 'Koin kamu belum cukup.',
  ITEM_TIDAK_ADA: 'Hadiah ini sudah tidak tersedia.',
  BUKAN_STAFF: 'Akun ini bukan akun kasir.',
  POIN_SALAH: 'Jumlah poin tidak valid.',
  VOUCHER_TIDAK_ADA: 'Voucher tidak ditemukan.',
  VOUCHER_SUDAH_DIPAKAI: 'Voucher sudah dipakai.',
  VOUCHER_KADALUARSA: 'Voucher sudah kadaluarsa.',
  EMAIL_SALAH: 'Email tidak valid.',
  PIN_SALAH: 'Nama atau PIN salah.',
  KASIR_TERKUNCI: 'Terlalu banyak PIN salah. Coba lagi 15 menit lagi.',
  SESI_KASIR_HABIS: 'Sesi kasir habis. Masuk lagi dengan PIN.',
  EMAIL_PERLU_KONFIRMASI: 'Akun dibuat tapi butuh konfirmasi email. Hubungi admin OOT.',
};
export function errText(e) {
  const m = String(e?.message || e || '');
  for (const k of Object.keys(MSG)) if (m.includes(k)) return MSG[k];
  if (/rate limit|over_email_send_rate_limit/i.test(m)) return 'Terlalu sering minta kode. Tunggu sebentar lalu coba lagi.';
  if (/expired|invalid.*otp|token has expired/i.test(m)) return 'Kode salah atau sudah kadaluarsa.';
  if (/invalid login credentials/i.test(m)) return 'Email atau password salah.';
  if (/anonymous sign-ins are disabled|signups not allowed/i.test(m)) return 'Pendaftaran sedang ditutup.';
  if (/already (been )?registered|already exists/i.test(m)) return 'Email ini sudah terdaftar. Pilih Masuk.';
  if (/password should be|at least 6|weak password/i.test(m)) return 'Password minimal 6 karakter.';
  if (/email not confirmed/i.test(m)) return 'Email belum dikonfirmasi. Hubungi admin OOT.';
  if (/unable to validate email|invalid format|email address.*invalid/i.test(m)) return 'Email tidak valid.';
  if (/fetch|network/i.test(m)) return 'Koneksi gagal. Cek internet kamu.';
  return m || 'Terjadi kesalahan.';
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}

/* ---------- auth ---------- */
export async function session() { return (await sb.auth.getSession()).data.session; }
// Players: email + password, no email verification ("Confirm email" is off in
// Supabase Auth), so the same account can log in again on another phone.
export async function signUp(email, password) {
  const s = await session();
  // Older accounts were anonymous: attach email + password to keep their coins.
  const { error } = s?.user?.is_anonymous
    ? await sb.auth.updateUser({ email, password })
    : await sb.auth.signUp({ email, password });
  if (error) throw error;
  if (!(await session())) throw new Error('EMAIL_PERLU_KONFIRMASI');
}
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export const isAnon = async () => !!(await session())?.user?.is_anonymous;
export async function logout() { await sb.auth.signOut(); }
export const onAuth = (cb) => sb.auth.onAuthStateChange((_ev, s) => cb(s));

/* ---------- player ---------- */
export const me = () => rpc('game_me');
export const saveProfile = (name, phone, email) => rpc('game_save_profile', { p_name: name, p_phone: phone, p_email: email || null });
export const redeemCode = (code) => rpc('game_redeem', { p_code: code });
export const buy = (item) => rpc('game_buy', { p_item: item });
export const leaderboard = (limit = 50) => rpc('game_leaderboard', { p_limit: limit });
// Partner coffee shops (supabase/places.sql). Hits feed the admin's game_place_stats.
export const places = () => rpc('game_places_list');
export const placeHit = (id, kind) => rpc('game_place_hit', { p_place: id, p_kind: kind }).catch(() => {});
export async function myVouchers() {
  const { data, error } = await sb.from('game_vouchers').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
export async function settings() {
  const { data, error } = await sb.from('game_settings').select('key,value');
  if (error) throw error;
  return Object.fromEntries(data.map((r) => [r.key, r.value]));
}

// Gameplay coins are batched: the game adds locally, then flushes to the
// server, which applies the daily cap and returns what actually counted.
let pending = 0, flushT = 0, flushing = null;
export function queuePlay(n, onResult) {
  pending += n;
  clearTimeout(flushT);
  flushT = setTimeout(() => flushPlay(onResult), 1500);
}
export async function flushPlay(onResult) {
  if (flushing || pending <= 0) return flushing;
  const n = pending; pending = 0;
  flushing = rpc('game_add_play', { p_amount: n, p_ref: 'game' })
    .then((r) => { onResult?.(r); return r; })
    .catch((e) => { pending += n; throw e; })
    .finally(() => { flushing = null; });
  return flushing;
}

/* ---------- staff (kasir.html): name + PIN, no Supabase Auth account ---------- */
// Cashiers are rows in the game_cashiers table (Table Editor). Login returns a
// 14-hour token kept in this browser; every cashier call sends it.
const K_KEY = 'oot_kasir';
export function kasirSession() {
  try { const k = JSON.parse(localStorage.getItem(K_KEY) || 'null'); return k && new Date(k.expires_at) > new Date() ? k : null; }
  catch { return null; }
}
export const kasirNames = async () => (await rpc('game_cashier_names')).map((r) => r.name);
export async function kasirLogin(name, pin) {
  const r = await rpc('game_cashier_login', { p_name: name, p_pin: pin });
  if (r?.error) throw new Error(r.error);
  try { localStorage.setItem(K_KEY, JSON.stringify(r)); } catch {}
  return r;
}
export async function kasirLogout() {
  const k = kasirSession();
  try { localStorage.removeItem(K_KEY); } catch {}
  if (k) await rpc('game_cashier_logout', { p_token: k.token }).catch(() => {});
}
async function krpc(fn, args) {
  const k = kasirSession();
  if (!k) throw new Error('SESI_KASIR_HABIS');
  try { return await rpc(fn, { p_token: k.token, ...args }); }
  catch (e) { if (String(e?.message).includes('SESI_KASIR_HABIS')) try { localStorage.removeItem(K_KEY); } catch {} throw e; }
}
export const createReceipt = (kind, points, note) => krpc('game_k_receipt', { p_kind: kind, p_points: points, p_note: note || null });
export const checkVoucher = (code, commit = false) => krpc('game_k_voucher', { p_code: code, p_commit: commit });
export const staffBoard = (limit = 50) => krpc('game_k_board', { p_limit: limit });
