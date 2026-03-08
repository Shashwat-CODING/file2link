const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/data', async (req, res) => {
    console.log("[*] Request received for TMDB 453395...");
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Uses /tmp instead of memory for shared memory
                '--disable-gpu',            // Saves memory on headless servers
                '--no-first-run',
                '--no-zygote',
                '--single-process'         // Forces one process to save RAM
            ]
        });

        const page = await browser.newPage();
        
        // Block heavy assets to save memory/bandwidth
        await page.setRequestInterception(true);
        let foundM3u8 = null;

        page.on('request', (request) => {
            const url = request.url();
            const type = request.resourceType();

            // Intercept the stream link
            if (url.includes('.m3u8') && !foundM3u8) {
                console.log("[+] Found m3u8:", url);
                foundM3u8 = url;
            }

            // Block images, CSS, and fonts to save memory
            if (['image', 'stylesheet', 'font', 'other'].includes(type)) {
                request.abort();
            } else {
                request.continue();
            }
        });

        const targetUrl = "https://player.videasy.net/movie/453395?color=FF0000";
        
        // Navigate
        await page.goto(targetUrl, { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // Small delay to ensure scripts are ready
        await new Promise(r => setTimeout(r, 2000));

        // Click center to trigger WASM decryption & stream request
        const { width, height } = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight
        }));
        
        console.log(`[*] Triggering click at ${width/2}, ${height/2}`);
        await page.mouse.click(width / 2, height / 2);

        // Polling for the intercepted URL
        let timeoutCount = 0;
        while (!foundM3u8 && timeoutCount < 20) {
            await new Promise(r => setTimeout(r, 500));
            timeoutCount++;
        }

        if (foundM3u8) {
            res.json({ success: true, url: foundM3u8 });
        } else {
            res.status(404).json({ success: false, error: "Stream link not found" });
        }

    } catch (err) {
        console.error("[!] Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`🚀 API active on port ${PORT}`);
});
