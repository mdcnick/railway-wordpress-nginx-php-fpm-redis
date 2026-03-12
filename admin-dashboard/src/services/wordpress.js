import { getSiteConnection } from './database.js';
import { PasswordHash } from 'phpass';

const hasher = new PasswordHash(8, true);

export async function setPasswordDirect(dbName, userLogin, newPassword) {
  const hash = hasher.hashPassword(newPassword);
  const conn = await getSiteConnection(dbName);
  try {
    const [result] = await conn.query(
      'UPDATE wp_users SET user_pass = ? WHERE user_login = ?',
      [hash, userLogin]
    );
    if (result.affectedRows === 0) {
      throw new Error(`User "${userLogin}" not found in database "${dbName}"`);
    }
    return { success: true };
  } finally {
    await conn.end();
  }
}

export async function listWpUsers(dbName) {
  const conn = await getSiteConnection(dbName);
  try {
    const [rows] = await conn.query(
      'SELECT ID, user_login, user_email, display_name FROM wp_users ORDER BY ID'
    );
    return rows;
  } finally {
    await conn.end();
  }
}

export async function triggerEmailReset(siteUrl, userLogin) {
  const url = `${siteUrl}/wp-login.php?action=lostpassword`;
  const body = new URLSearchParams({
    user_login: userLogin,
    redirect_to: '',
    'wp-submit': 'Get New Password',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual',
  });
  return { status: res.status, success: res.status === 302 || res.status === 200 };
}
