// Yeni sürüm çıkarır:  npm run release 0.2.0
//
// 1. Sürüm numarasını package.json, package-lock.json, tauri.conf.json,
//    Cargo.toml ve Cargo.lock'ta değiştirir.
// 2. "Sürüm 0.2.0" commit'i atar, v0.2.0 etiketini koyar, ikisini de gönderir.
// 3. GitHub Actions (.github/workflows/release.yml) kurulum dosyasını derleyip
//    Releases'e koyar; kurulu dock'lar birkaç saat içinde kendini günceller.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Kullanım: npm run release <sürüm>   (ör. npm run release 0.2.0)");
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const out = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

if (out("git status --porcelain")) {
  console.error("Commit'lenmemiş değişiklik var; önce onları commit'le.");
  process.exit(1);
}
if (out(`git tag --list v${version}`)) {
  console.error(`v${version} etiketi zaten var.`);
  process.exit(1);
}

const edit = (path, change) => {
  const before = readFileSync(path, "utf8");
  const after = change(before);
  if (after === before) throw new Error(`${path}: sürüm alanı bulunamadı`);
  writeFileSync(path, after);
};

// JSON dosyalarında yalnızca ilgili satırı değiştir (biçim ve satır sonları korunur).
const jsonVersion = (text) => text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
edit("package.json", jsonVersion);
edit("src-tauri/tauri.conf.json", jsonVersion);
edit("package-lock.json", (text) => {
  // Kök kayıt ve packages[""] kaydı: dosyadaki ilk iki "version".
  let n = 0;
  return text.replace(/("version":\s*")[^"]+(")/g, (m, a, b) =>
    n++ < 2 ? `${a}${version}${b}` : m,
  );
});
edit("src-tauri/Cargo.toml", (text) =>
  text.replace(/(\[package\][^[]*?\nversion\s*=\s*")[^"]+(")/, `$1${version}$2`),
);
edit("src-tauri/Cargo.lock", (text) =>
  text.replace(/(name = "akilli-dock"\r?\nversion = ")[^"]+(")/, `$1${version}$2`),
);

run(
  "git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock",
);
run(`git commit -m "Sürüm ${version}"`);
run(`git tag v${version}`);
run("git push");
run(`git push origin v${version}`);
console.log(
  `\nv${version} gönderildi. Derleme ~15 dk sürer: https://github.com/Bthncko/Task-Bar/actions`,
);
