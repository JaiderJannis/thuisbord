// Genereert automatisch haarscherpe PNG-iconen voor iOS (180x180), Android (192x192 & 512x512) en Favicon (32x32)
(function setupThuisbordAppIcons() {
    function renderLogoToDataUrl(size, isAppleTouch) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = size / 512;

        // Voor iOS Apple Touch Icon vullen we de achtergrond volledig (iOS rondt zelf de hoeken af)
        const radius = isAppleTouch ? 0 : 118 * scale;
        ctx.fillStyle = '#18261f';
        ctx.beginPath();
        if (radius > 0 && ctx.roundRect) {
            ctx.roundRect(0, 0, size, size, radius);
        } else {
            ctx.rect(0, 0, size, size);
        }
        ctx.fill();

        // Teken het groene Thuisbord huis-icoon exact zoals op het geüploade logo
        ctx.strokeStyle = '#5cd69c';
        ctx.lineWidth = 28 * scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(256 * scale, 140 * scale);
        ctx.lineTo(148 * scale, 228 * scale);
        ctx.lineTo(148 * scale, 364 * scale);
        ctx.lineTo(222 * scale, 364 * scale);
        ctx.lineTo(222 * scale, 292 * scale);
        ctx.lineTo(290 * scale, 292 * scale);
        ctx.lineTo(290 * scale, 364 * scale);
        ctx.lineTo(364 * scale, 364 * scale);
        ctx.lineTo(364 * scale, 228 * scale);
        ctx.closePath();
        ctx.stroke();

        return canvas.toDataURL('image/png');
    }

    window.addEventListener('DOMContentLoaded', () => {
        try {
            const fav32 = renderLogoToDataUrl(32, false);
            const apple180 = renderLogoToDataUrl(180, true);
            const android192 = renderLogoToDataUrl(192, false);
            const android512 = renderLogoToDataUrl(512, false);

            const favEl = document.getElementById('dynamicFaviconPng');
            const appleEl = document.getElementById('dynamicAppleTouchIcon');
            if (favEl) favEl.href = fav32;
            if (appleEl) appleEl.href = apple180;

            const manifestObj = {
                name: "Thuisbord Smart Home Dashboard",
                short_name: "Thuisbord",
                start_url: "./",
                display: "standalone",
                background_color: "#eef2ed",
                theme_color: "#18261f",
                icons: [
                    { src: android192, sizes: "192x192", type: "image/png", purpose: "any maskable" },
                    { src: android512, sizes: "512x512", type: "image/png", purpose: "any maskable" }
                ]
            };
            const manifestBlob = new Blob([JSON.stringify(manifestObj)], { type: 'application/manifest+json' });
            const manifestEl = document.getElementById('dynamicWebManifest');
            if (manifestEl) manifestEl.href = URL.createObjectURL(manifestBlob);
        } catch (e) {
            console.warn("Kon dynamische iconen niet genereren:", e);
        }
    });
})();
