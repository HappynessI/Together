import bcrypt from "bcryptjs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const supplied = process.argv[2];
let password = supplied;
if (!password) {
  const reader = readline.createInterface({ input, output });
  password = await reader.question("Password (will not be stored): ");
  reader.close();
}
if (!password || password.length < 12) {
  console.error("Use a password with at least 12 characters.");
  process.exit(1);
}
console.log(await bcrypt.hash(password, 12));
