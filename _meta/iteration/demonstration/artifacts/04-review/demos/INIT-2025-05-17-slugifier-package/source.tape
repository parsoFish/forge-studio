# Demo: INIT-2025-05-17-slugifier-package — Canonical URL-safe slugifier package
#
# Acceptance criteria exercised (then-clause keywords):
# WI-1 / FEAT-1:
#   - returns ""  (empty string → empty string)
#   - returns "hello-world" (ASCII title lowercased, spaces become hyphens)
#   - returns "es2025-release" (numbers preserved)
#   - returns "angstrom-resume" (accents stripped via NFD, & collapsed)
#   - returns "" (non-Latin/emoji dropped, result trims to empty)
#   - returns "" (no transliteration; all chars dropped)
#   - returns "foo-bar-baz" (consecutive separators collapsed)
#   - returns "hello" (leading/trailing hyphens trimmed)
# WI-3 / FEAT-2:
#   - slugifyMany returns ["hello-world", "es2025", ""] preserving order
#   - uniqueSlug returns "foo" because the slug is not in the taken list
#   - uniqueSlug returns "foo-2" using the smallest integer suffix starting at 2
#   - uniqueSlug returns "foo-3" skipping already-taken suffixed variants
#   - uniqueSlug returns "foo-5"
# WI-4 / FEAT-3:
#   - returns "hello_world" (custom separator used throughout)
#   - returns "hello-beaut" (truncated at 11 chars; no trailing separator)
#   - returns "hello" (truncated to 6; trailing - re-trimmed → no trailing separator)
#   - returns "hello_wor" (both options applied; trailing _ trimmed if present)
#   - returns "hello-world" (defaults apply; identical to no-options call)
#   - returns "hello-world" (non-positive maxLength ignored)

Output recording.mp4
Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 700
Set Theme "Dracula"
Set PlaybackSpeed 0.75

# --- Setup ---
Type "cd /tmp/forge-bench-chained-p33ZFj/projects/slugifier"
Enter
Sleep 500ms

Type "echo '=== Canonical URL-safe slugifier — live demo ==='"
Enter
Sleep 500ms

# --- WI-1 / FEAT-1: Core slugify function ---
Type "echo '-- FEAT-1: Core slugify function --'"
Enter
Sleep 300ms

# AC: empty string returns ""
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('empty string:', JSON.stringify(slugify('')));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: ASCII title returns "hello-world"
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('hello-world:', slugify('Hello World'));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: numbers preserved → "es2025-release"
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('numbers preserved:', slugify('ES2025 Release'));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: accents stripped via NFD → "angstrom-resume"
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('angstrom-resume:', slugify('Ångström & Résumé'));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: emoji dropped, result trims to empty → ""
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('emoji to empty:', JSON.stringify(slugify('🚀🎉')));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: no transliteration; all chars dropped → ""
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('non-latin to empty:', JSON.stringify(slugify('日本語タイトル')));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: consecutive separators collapsed → "foo-bar-baz"
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('foo-bar-baz:', slugify('foo---bar  baz'));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: leading/trailing hyphens trimmed → "hello"
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('leading/trailing trimmed:', slugify('--hello--'));"
Enter
Type "EOF"
Enter
Sleep 800ms

# --- WI-3 / FEAT-2: Batch helpers ---
Type "echo '-- FEAT-2: Batch helpers (slugifyMany, uniqueSlug) --'"
Enter
Sleep 300ms

# AC: slugifyMany returns ["hello-world", "es2025", ""] preserving order
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugifyMany } from './src/batch.ts';"
Enter
Type "const result = slugifyMany(['Hello World', 'ES2025', '']);"
Enter
Type "console.log('slugifyMany preserving order:', JSON.stringify(result));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: uniqueSlug returns "foo" because the slug is not in the taken list
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { uniqueSlug } from './src/batch.ts';"
Enter
Type "console.log('uniqueSlug not in taken:', uniqueSlug('foo', []));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: uniqueSlug returns "foo-2" using the smallest integer suffix starting at 2
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { uniqueSlug } from './src/batch.ts';"
Enter
Type "console.log('uniqueSlug foo-2:', uniqueSlug('foo', ['foo']));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: uniqueSlug returns "foo-3" skipping already-taken suffixed variants
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { uniqueSlug } from './src/batch.ts';"
Enter
Type "console.log('uniqueSlug foo-3:', uniqueSlug('foo', ['foo', 'foo-2']));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: uniqueSlug returns "foo-5"
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { uniqueSlug } from './src/batch.ts';"
Enter
Type "console.log('uniqueSlug foo-5:', uniqueSlug('foo', ['foo', 'foo-2', 'foo-3', 'foo-4']));"
Enter
Type "EOF"
Enter
Sleep 800ms

# --- WI-4 / FEAT-3: Configurable options ---
Type "echo '-- FEAT-3: Configurable options (separator, maxLength) --'"
Enter
Sleep 300ms

# AC: custom separator used throughout → "hello_world"
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('hello_world:', slugify('Hello World', { separator: '_' }));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: truncated at 11 chars; no trailing separator → "hello-beaut"
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('hello-beaut:', slugify('Hello Beautiful World', { maxLength: 11 }));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: truncated to 6; trailing - re-trimmed; no trailing separator remains → "hello"
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('maxLength trailing trimmed:', slugify('Hello World', { maxLength: 6 }));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: both options applied; trailing _ trimmed if present → "hello_wor"
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('hello_wor:', slugify('Hello World', { separator: '_', maxLength: 9 }));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: defaults apply; identical to no-options call → "hello-world"
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('empty options defaults:', slugify('Hello World', {}));"
Enter
Type "EOF"
Enter
Sleep 800ms

# AC: non-positive maxLength ignored → "hello-world"
Type "node --input-type=module --experimental-strip-types <<'EOF'"
Enter
Type "import { slugify } from './src/slugify.ts';"
Enter
Type "console.log('maxLength:0 ignored:', slugify('Hello World', { maxLength: 0 }));"
Enter
Type "EOF"
Enter
Sleep 800ms

# --- Run the full test suite ---
Type "echo '-- Running npm test --silent (quality gate) --'"
Enter
Sleep 300ms
Type "npm test --silent 2>&1 | tail -6"
Enter
Sleep 2000ms

Type "echo '=== Demo complete: all acceptance criteria verified ==='"
Enter
Sleep 1000ms
