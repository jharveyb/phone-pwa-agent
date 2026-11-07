const status = document.getElementById("status")!;
const log = document.getElementById("log")!;
function line(s: string) {
  log.textContent += `[${new Date().toISOString()}] ${s}\n`;
  console.log(s);
}
line(`hello from phone-agent; secureContext=${window.isSecureContext} ua=${navigator.userAgent}`);
line(`OPFS=${!!navigator.storage?.getDirectory} wakeLock=${"wakeLock" in navigator} locks=${"locks" in navigator} SW=${"serviceWorker" in navigator}`);
status.textContent = `alive since ${new Date().toISOString()}`;
setInterval(() => (status.textContent = `alive, ${new Date().toISOString()}`), 1000);
