// Thin wrapper around the qrcode-generator CDN library so pages don't repeat
// the rendering boilerplate. Renders a join link as a scannable code into a
// container element (a <div>, not a <canvas> — this library draws an <img>).
window.SprayQR = {
  render(containerEl, text) {
    if (!text) { containerEl.innerHTML = ""; return; }
    const qr = qrcode(0, "M"); // 0 = auto-pick the smallest type that fits the data
    qr.addData(text);
    qr.make();
    containerEl.innerHTML = qr.createImgTag(6, 8);
    const img = containerEl.querySelector("img");
    if (img) img.style.borderRadius = "12px";
  },
};
