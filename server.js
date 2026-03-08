const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/data', async (req, res) => {
    const tmdbId = req.query.id || "453395";
    const targetUrl = `https://player.videasy.net/movie/${tmdbId}?color=FF0000`;
    
    let browser;
    // forensic collectors
    const forensics = {
        failed: [],    // 4xx, 5xx, or network drops
        intercepted: [], // successfully caught m3u8s
        blocked: []    // assets we manually blocked to save RAM
    };

    try {
        console.log(`\n[*] forensic session started for TMDB: ${tmdbId}`);
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process']
        });

        const page = await browser.newPage();

        // 1. DEACTIVATE BREAKPOINTS & DEBUGGER
        const client = await page.target().createCDPSession();
        await client.send('Debugger.enable');
        await client.send('Debugger.setSkipAllPauses', { skip: true });

        // 2. LOG ALL NETWORK TRAFFIC
        await page.setRequestInterception(true);
        let foundM3u8 = null;

        page.on('request', (request) => {
            const url = request.url();
            const type = request.resourceType();

            if (url.includes('.m3u8')) {
                forensics.intercepted.push(url);
                if (!foundM3u8) foundM3u8 = url;
            }

            // Block memory-intensive assets but track them
            if (['image', 'font'].includes(type)) {
                forensics.blocked.push(`${type.toUpperCase()}: ${url.substring(0, 50)}...`);
                request.abort();
            } else {
                request.continue();
            }
        });

        // 3. TRACK FAILED RESPONSES (403, 404, 500, etc.)
        page.on('requestfailed', request => {
            forensics.failed.push({
                url: request.url(),
                reason: request.failure().errorText,
                type: request.resourceType()
            });
        });

        page.on('response', response => {
            if (response.status() >= 400) {
                forensics.failed.push({
                    url: response.url(),
                    status: response.status(),
                    statusText: response.statusText(),
                    type: response.request().resourceType()
                });
            }
        });

        // 4. NAVIGATION & CLICK ACTION
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 40000 });
        await new Promise(r => setTimeout(r, 3000));
        
        console.log("[ACTION] Executing center-click...");
        await page.mouse.click(400, 300); 

        // Polling loop
        let attempts = 0;
        while (!foundM3u8 && attempts < 20) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }

        if (foundM3u8) {
            return res.json({ success: true, url: foundM3u8 });
        }

        // --- 5. DETAILED FAIL REPORT ---
        const screenshot = await page.screenshot({ encoding: 'base64' });
        const htmlDump = await page.content();

        res.header("Content-Type", "text/html");
        res.send(`
            <!DOCTYPE html>
            <html style="background:#0a0a0a; color:#eee; font-family:monospace; padding:30px;">
            <head><title>IIT Project: Forensic Dump</title></head>
            <body>
                <h1 style="color:#ff5252">Capture Failed: Link Not Intercepted</h1>
                
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
                    <div>
                        <h3>1. Visual State (Screenshot)</h3>
                        <img src="data:image/png;base64,${screenshot}" style="width:100%; border:1px solid #444;" />
                    </div>
                    <div>
                        <h3 style="color:#ffab00">2. Error Log (HTTP 4xx/5xx & Network Drops)</h3>
                        <div style="background:#000; padding:15px; border:1px solid #333; max-height:450px; overflow-y:auto;">
                            ${forensics.failed.length > 0 ? 
                                forensics.failed.map(f => `
                                    <div style="border-bottom:1px solid #222; padding:8px 0; margin-bottom:8px;">
                                        <b style="color:#ff5252">[${f.status || 'FAILED'}]</b> ${f.type.toUpperCase()}<br/>
                                        <small style="color:#888; word-break:break-all;">${f.url}</small><br/>
                                        <span style="color:#aaa; font-size:11px;">Reason: ${f.reason || f.statusText || 'Unknown'}</span>
                                    </div>
                                `).join('') : 
                                '<p style="color:#555">No external requests failed.</p>'
                            }
                        </div>
                    </div>
                </div>

                <h3>3. DOM State (Live HTML)</h3>
                <textarea style="width:100%; height:250px; background:#000; color:#0f0; border:1px solid #333; padding:10px;">${htmlDump.replace(/</g, "&lt;")}</textarea>
                
                <div style="margin-top:20px; border-top:1px solid #333; padding-top:10px; color:#555">
                    <b>Diagnostics Summary:</b><br/>
                    M3U8 Catch Attempts: ${forensics.intercepted.length}<br/>
                    Manually Blocked Assets: ${forensics.blocked.length}
                </div>
            </body>
            </html>
        `);

    } catch (err) {
        res.status(500).send(`Critical Failure: ${err.message}`);
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`🚀 Forensic Server Active on ${PORT}`));
