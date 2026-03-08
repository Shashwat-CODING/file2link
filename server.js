const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/data', async (req, res) => {
    const tmdbId = req.query.id || "453395";
    console.log(`\n--- [EXPRESS] Request for ID: ${tmdbId} ---`);
    
    let browser;
    try {
        console.log("[BROWSER] Launching optimized Chromium...");
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--single-process',
                '--disable-blink-features=AutomationControlled' // Extra stealth
            ]
        });

        const page = await browser.newPage();

        // --- ANTI-DEBUGGER BYPASS ---
        // This stops the 'debugger' statement from pausing the script
        const client = await page.target().createCDPSession();
        await client.send('Debugger.enable');
        await client.send('Debugger.setSkipAllPauses', { skip: true });
        console.log("[BROWSER] Breakpoints/Pauses deactivated.");

        await page.setRequestInterception(true);
        let foundM3u8 = null;

        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('.m3u8')) {
                console.log(`[INTERCEPTOR] Caught M3U8: ${url.substring(0, 40)}...`);
                if (!foundM3u8) foundM3u8 = url;
            }
            if (['image', 'stylesheet', 'font'].includes(request.resourceType())) request.abort();
            else request.continue();
        });

        console.log("[ACTION] Navigating to player...");
        await page.goto(`https://player.videasy.net/movie/${tmdbId}?color=FF0000`, { 
            waitUntil: 'networkidle2', timeout: 30000 
        });

        // Small delay for stability
        await new Promise(r => setTimeout(r, 2500));

        // Click center to trigger decryption math
        console.log("[ACTION] Triggering player click...");
        await page.mouse.click(400, 300); 

        // Polling loop
        let attempts = 0;
        while (!foundM3u8 && attempts < 15) {
            await new Promise(r => setTimeout(r, 600));
            attempts++;
        }

        if (foundM3u8) {
            console.log("[EXPRESS] Success. Sending JSON.");
            return res.json({ success: true, url: foundM3u8 });
        }

        // --- FALLBACK: RETURN FULL HTML DECRYPTER ---
        console.warn("[EXPRESS] No link caught. Sending HTML Bridge Fallback.");
        res.header("Content-Type", "text/html");
        res.send(generateFallbackHtml(tmdbId));

    } catch (err) {
        console.error(`[ERROR] ${err.message}`);
        res.status(500).send(`Error: ${err.message}`);
    } finally {
        if (browser) await browser.close();
    }
});

function generateFallbackHtml(id) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Manual Bridge - ${id}</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js"></script>
        <style>
            body { background: #000; color: #00ff41; font-family: 'Courier New', monospace; padding: 40px; text-align: center; }
            .box { border: 1px solid #333; padding: 20px; display: inline-block; border-radius: 8px; background: #0a0a0a; }
            .loader { border: 3px solid #111; border-top: 3px solid #00ff41; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 15px auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            #res { margin-top: 20px; color: #fff; text-align: left; background: #111; padding: 10px; border-radius: 4px; display: none; word-break: break-all; }
        </style>
    </head>
    <body>
        <div class="box">
            <h3>Automated Capture Failed</h3>
            <p>Running Client-Side Decryption Bridge...</p>
            <div class="loader" id="loader"></div>
            <div id="status">Fetching encrypted sources...</div>
            <pre id="res"></pre>
        </div>

        <script>
            const TMDB_ID = "${id}";
            const AES_KEY = "b35ebba4";

            async function start() {
                const status = document.getElementById('status');
                const resBox = document.getElementById('res');
                try {
                    status.innerText = "Step 1: Fetching API data...";
                    const apiRes = await fetch("https://api.videasy.net/myflixerzupcloud/sources-with-title?tmdbId=" + TMDB_ID);
                    const hex = (await apiRes.text()).replace(/['"]/g, '');

                    status.innerText = "Step 2: Replicating WASM math...";
                    // Using the pure JS logic we built earlier
                    const bytes = hex.match(/.{1,2}/g).map(b => parseInt(b, 16));
                    const xored = bytes.map((b, i) => b ^ TMDB_ID.charCodeAt(i % TMDB_ID.length));
                    const b64 = btoa(String.fromCharCode(...xored));

                    status.innerText = "Step 3: Final AES layer...";
                    const decrypted = CryptoJS.AES.decrypt(b64, AES_KEY).toString(CryptoJS.enc.Utf8);
                    
                    document.getElementById('loader').style.display = 'none';
                    status.innerText = "DECRYPTION SUCCESSFUL:";
                    resBox.style.display = "block";
                    resBox.innerText = JSON.stringify(JSON.parse(decrypted), null, 2);
                } catch (e) {
                    status.style.color = "red";
                    status.innerText = "Critical Fail: " + e.message;
                }
            }
            start();
        </script>
    </body>
    </html>
    `;
}

app.listen(PORT, () => console.log(`🚀 API active on ${PORT}`));
