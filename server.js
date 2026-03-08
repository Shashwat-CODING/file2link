const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = 3000;

app.get('/data', async (req, res) => {
    console.log("[*] Request received. Launching browser...");
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true, // Set to false if you want to watch it work
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        // Target URL
        const targetUrl = "https://player.videasy.net/movie/453395?color=FF0000";
        let foundM3u8 = null;

        // --- NETWORK INTERCEPTION ---
        // We listen to every request the page makes
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            
            // Check if this is the master playlist or a stream chunk
            if (url.includes('.m3u8') && !foundM3u8) {
                console.log("[+] Intercepted m3u8:", url);
                foundM3u8 = url;
            }
            request.continue();
        });

        // Navigate to the player
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait a moment for any overlay/ads to settle
        await new Promise(r => setTimeout(r, 2000));

        // --- SIMULATE CENTER CLICK ---
        // Most players require a user gesture to start the stream/decryption
        const { width, height } = await page.evaluate(() => {
            return { width: window.innerWidth, height: window.innerHeight };
        });

        console.log(`[*] Clicking center: ${width / 2}, ${height / 2}`);
        await page.mouse.click(width / 2, height / 2);

        // Wait for the network request to be triggered after the click
        // We give it up to 10 seconds to find the link
        let attempts = 0;
        while (!foundM3u8 && attempts < 20) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }

        if (foundM3u8) {
            res.json({
                success: true,
                url: foundM3u8,
                tmdbId: "453395"
            });
        } else {
            res.status(404).json({
                success: false,
                error: "Stream URL not found within timeout."
            });
        }

    } catch (error) {
        console.error("[!] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}`);
    console.log(`🔗 Call http://localhost:${PORT}/data to get the m3u8 URL\n`);
});
