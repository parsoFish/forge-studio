/**
 * `safeReadFileInSession` — the realpath-guarded read of one file inside a
 * directory, the choke point every session-dir and project-dir reader goes
 * through. The leaf is realpath-resolved and must stay under the directory's
 * own realpath, so a symlink inside the directory cannot leak content from
 * outside it. A missing directory, a missing or unreadable file, and an
 * escaping symlink all read as absent (null).
 */
import { readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

export function safeReadFileInSession(sessionDir: string, relPath: string): string | null {
  const abs = join(sessionDir, relPath);
  let realSessionDir: string;
  try {
    realSessionDir = realpathSync(sessionDir);
  } catch {
    return null; // sessionDir itself doesn't exist / unreadable
  }
  let realAbs: string;
  try {
    realAbs = realpathSync(abs);
  } catch {
    return null; // missing file, broken symlink, or unreadable path segment
  }
  if (realAbs !== realSessionDir && !realAbs.startsWith(realSessionDir + sep)) {
    return null; // escapes sessionDir via a symlink — treated as absent, never returned
  }
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}
