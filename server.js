const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/data', async (req, res) => {
    const tmdbId = req.query.id || "453395";
    console.log(`\n--- [RECORDER] Diagnosing ID: ${tmdbId} ---`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--single-process',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();

        // 1. KILL DEBUGGER TRAPS
        const client = await page.target().createCDPSession();
        await client.send('Debugger.enable');
        await client.send('Debugger.setSkipAllPauses', { skip: true });

        await page.setRequestInterception(true);
        let foundM3u8 = null;

        page.on('request', (request) => {
            if (request.url().includes('.m3u8')) {
                foundM3u8 = request.url();
            }
            // We allow scripts/xhr so we can see the full page state
            if (['image', 'font'].includes(request.resourceType())) request.abort();
            else request.continue();
        });

        console.log("[RECORDER] Loading player page...");
        await page.goto(`https://player.videasy.net/movie/${tmdbId}?color=FF0000`, { 
            waitUntil: 'networkidle2', timeout: 30000 
        });

        await new Promise(r => setTimeout(r, 3000));
        
        // 2. TRY THE CLICK
        await page.mouse.click(400, 300); 

        let attempts = 0;
        while (!foundM3u8 && attempts < 10) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }

        if (foundM3u8) {
            return res.json({ success: true, url: foundM3u8 });
        }

        // --- 3. DIAGNOSTIC CAPTURE ---
        console.log("[RECORDER] Capture initiated: No link found.");
        
        // Capture the DOM state
        const htmlDump = await page.content();
        // Capture a screenshot as a Base64 string
        const screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });

        res.header("Content-Type", "text/html");
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Server-Side Diagnostic Dump</title>
                <style>
                    body { background: #121212; color: #fff; font-family: sans-serif; padding: 20px; }
                    .panel { background: #1e1e1e; border: 1px solid #333; padding: 20px; margin-bottom: 20px; border-radius: 8px; }
                    h2 { color: #ff5252; }
                    img { max-width: 100%; border: 2px solid #555; }
                    textarea { width: 100%; height: 300px; background: #000; color: #0f0; font-family: monospace; }
                </style>
            </head>
            <body>
                <h2>Diagnostic Report: Link Not Found</h2>
                <p>This is exactly what the browser on the server saw before giving up.</p>
                
                <div class="panel">
                    <h3>Visual Screenshot</h3>
                    <img src="data:image/png;base64,${screenshot}" />
                </div>

                <div class="panel">
                    <h3>Full HTML Source (Live State)</h3>
                    <p>Search for "debugger", "blocked", or "error" in this text:</p>
                    <textarea readonly>${htmlDump.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</textarea>
                </div>

                <div class="panel">
                    <h3>Possible Reasons:</h3>
                    <ul>
                        <li><strong>Anti-Bot:</strong> If the screenshot shows a blank page or a cloudflare challenge.</li>
                        <li><strong>Breakpoint Loop:</strong> If the HTML contains infinite loops of <code>Function("debugger")()</code>.</li>
                        <li><strong>Region Block:</strong> If the screenshot shows "Not available in your country".</li>
                    </ul>
                </div>
            </body>
            </html>
        `);

    } catch (err) {
        res.status(500).send(`Browser Crash: ${err.message}`);
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`🚀 Forensic Server active on ${PORT}`));
