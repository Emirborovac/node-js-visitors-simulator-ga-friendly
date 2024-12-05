const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();
const os = require('os');

// Enhanced Configuration
const CONFIG = {
    MAX_SESSIONS: 360,
    SESSION_DURATION: 45000,
    GROUP_SIZE: 5,
    PROXY_USERNAME: "",
    PROXY_PASSWORD: "",
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 5000,
    CLEANUP_INTERVAL: 6000, // 1 minute
    DASHBOARD_UPDATE_INTERVAL: 3000 // 3 seconds
};

const axios = require('axios');
const base64 = require('base-64');

const WORDPRESS_CONFIGS = {
    nuanshaber: {
        username: "",
        password: "",
        api_url: ""
    }
};

// Fetch the recent 10 URLs from WordPress API
// Fetch exactly 10 non-video URLs from WordPress API
async function fetchRecentPosts() {
    const { username, password, api_url } = WORDPRESS_CONFIGS.nuanshaber;
    let page = 1;
    let filteredUrls = [];
    const REQUIRED_URLS = 10;

    try {
        while (filteredUrls.length < REQUIRED_URLS) {
            const authHeader = `Basic ${base64.encode(`${username}:${password}`)}`;
            // Request more posts per page to reduce number of API calls needed
            const response = await axios.get(`${api_url}/posts?per_page=50&page=${page}`, {
                headers: { Authorization: authHeader }
            });

            // If no more posts are available, break
            if (!response.data || response.data.length === 0) {
                console.log(`Could only fetch ${filteredUrls.length} non-video URLs from available posts`);
                break;
            }

            // Add non-video URLs
            const newUrls = response.data
                .filter(post => !post.link.includes('/video/'))
                .map(post => post.link);

            filteredUrls = [...filteredUrls, ...newUrls];
            page++;

            // If we have more than enough, trim to exactly 10
            if (filteredUrls.length >= REQUIRED_URLS) {
                filteredUrls = filteredUrls.slice(0, REQUIRED_URLS);
                break;
            }
        }

        if (filteredUrls.length === REQUIRED_URLS) {
            console.log(`Successfully fetched ${REQUIRED_URLS} non-video URLs`);
        }

        return filteredUrls;
    } catch (error) {
        console.error("Error fetching recent posts:", error.message);
        return [];
    }
}

let URLS = [];

// Refresh URLs every 2 hours
async function scheduleURLFetch() {
    while (!isShuttingDown) {
        console.log("Fetching recent posts...");
        URLS = await fetchRecentPosts();
        if (URLS.length > 0) {
            console.log(`Fetched ${URLS.length} new URLs.`);
        } else {
            console.error("Failed to fetch new URLs. Retrying in 2 hours.");
        }
        await new Promise(resolve => setTimeout(resolve, 2 * 60 * 60 * 1000)); // 2 hours
    }
}


// Original Mobile screen sizes
const SCREEN_SIZES = [
    { width: 375, height: 812 },  // iPhone X/XS/11 Pro
    { width: 414, height: 896 },  // iPhone XR/XS Max/11
    { width: 360, height: 740 },  // Samsung Galaxy S8/S9/S10
    { width: 412, height: 915 },  // Pixel 6
    { width: 390, height: 844 },  // iPhone 12/13/14
    { width: 393, height: 851 },  // Pixel 7
    { width: 360, height: 800 },  // Samsung Galaxy A series
    { width: 428, height: 926 },  // iPhone 12/13/14 Pro Max
    { width: 384, height: 824 },  // Google Pixel 4
    { width: 360, height: 780 }   // Various Android devices
];

// Enhanced Stats Tracking with Detailed Error Logging
const stats = {
    sessionsOpened: 0,
    activeSessionsCount: 0,
    sessionsCompleted: 0,
    sessionsFailed: 0,
    totalTabsActive: 0,
    averageSessionDuration: 0,
    lastUpdateTimestamp: Date.now(),
    groupsCompleted: 0,
    totalMemoryUsage: 0,
    cpuUsage: 0,
    startTime: Date.now(),
    errors: {
        proxy: {
            total: 0,
            connection: 0,
            authentication: 0,
            timeout: 0
        },
        browser: {
            total: 0,
            navigation: 0,
            pageLoad: 0,
            clicking: 0,
            scrolling: 0,
            mouseMovement: 0,
            sessionCreation: 0
        },
        errorHistory: []
    }
};

// State Management
let userAgents = [];
let currentUserAgentIndex = 0;
let waitingForGroup = new Set();
let activeGroups = new Set();
let totalActiveSessions = 0;
let groupCounter = 0;
let sessionsInProgress = new Set();
let isShuttingDown = false;

// Error logging function
function logError(category, type, error) {
    const errorDetails = {
        timestamp: new Date().toISOString(),
        category,
        type,
        message: error.message || 'Unknown error',
        stack: error.stack
    };

    stats.errors[category].total++;
    if (stats.errors[category][type] !== undefined) {
        stats.errors[category][type]++;
    }

    stats.errors.errorHistory.unshift(errorDetails);
    if (stats.errors.errorHistory.length > 50) {
        stats.errors.errorHistory.pop();
    }
}

// Enhanced Dashboard with Detailed Error Reporting
function updateDashboard() {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    const dashboard = `
╔═══════════════════════════════════════════════════════════════╗
                    SESSION MANAGER STATUS                    
╠═══════════════════════════════════════════════════════════════╣
   📊 Sessions Stats
   ├─ Opened         : ${stats.sessionsOpened.toString().padEnd(8)}
   ├─ Active         : ${stats.activeSessionsCount.toString().padEnd(8)}
   ├─ Completed      : ${stats.sessionsCompleted.toString().padEnd(8)}
   └─ Failed         : ${stats.sessionsFailed.toString().padEnd(8)}
   
   🌐 System Stats
   ├─ Active Tabs    : ${stats.totalTabsActive.toString().padEnd(8)}
   ├─ Memory (RSS)   : ${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB
   ├─ Heap Used      : ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB
   └─ Uptime         : ${(uptime / 60).toFixed(2)} minutes
   
   ⚠️ Browser Errors
   ├─ Navigation     : ${stats.errors.browser.navigation.toString().padEnd(8)}
   ├─ Page Load      : ${stats.errors.browser.pageLoad.toString().padEnd(8)}
   ├─ Click          : ${stats.errors.browser.clicking.toString().padEnd(8)}
   ├─ Scroll         : ${stats.errors.browser.scrolling.toString().padEnd(8)}
   └─ Session        : ${stats.errors.browser.sessionCreation.toString().padEnd(8)}
   
   🔌 Proxy Errors
   ├─ Connection     : ${stats.errors.proxy.connection.toString().padEnd(8)}
   ├─ Auth           : ${stats.errors.proxy.authentication.toString().padEnd(8)}
   └─ Timeout        : ${stats.errors.proxy.timeout.toString().padEnd(8)}
   
   📝 Last 3 Errors:
${stats.errors.errorHistory.slice(0, 3).map(err => 
    `   [${err.timestamp}] ${err.category}/${err.type}: ${err.message}`
).join('\n')}
╚═══════════════════════════════════════════════════════════════╝
`;
    process.stdout.write('\x1B[2J\x1B[0f' + dashboard);
}

// Original user agent loading with improved error handling
async function loadUserAgents() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(path.join(__dirname, './data/user_agents.db'), (err) => {
            if (err) {
                stats.browserErrors++;
                reject(err);
                return;
            }
            
            db.all('SELECT user_agent FROM mobile_user_agents', [], (err, rows) => {
                if (err) {
                    db.close();
                    stats.browserErrors++;
                    reject(err);
                    return;
                }

                userAgents = rows.map(row => row.user_agent);
                if (userAgents.length === 0) {
                    db.close();
                    reject(new Error('No user agents found'));
                    return;
                }

                db.close((err) => {
                    if (err) {
                        stats.browserErrors++;
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        });
    });
}

// Original helper functions with added error handling
function getNextUserAgent() {
    if (userAgents.length === 0) {
        stats.browserErrors++;
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
    }
    const userAgent = userAgents[currentUserAgentIndex];
    currentUserAgentIndex = (currentUserAgentIndex + 1) % userAgents.length;
    return userAgent;
}

function getRandomScreenSize() {
    return SCREEN_SIZES[Math.floor(Math.random() * SCREEN_SIZES.length)];
}

// Enhanced proxy loading with retry mechanism
async function loadProxies() {
    for (let attempt = 1; attempt <= CONFIG.RETRY_ATTEMPTS; attempt++) {
        try {
            const data = await fs.readFile(path.join(__dirname, './data/DedicatedDataCenter.json'), 'utf8');
            return JSON.parse(data);
        } catch (error) {
            stats.proxyErrors++;
            if (attempt === CONFIG.RETRY_ATTEMPTS) throw error;
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
        }
    }
}

// Enhanced browser session creation
async function createBrowserSession(proxyData) {
    try {
        const proxyConfig = {
            server: `http://${proxyData.ip}:${proxyData.port}`,
            username: CONFIG.PROXY_USERNAME,
            password: CONFIG.PROXY_PASSWORD
        };

        const browser = await chromium.launch({
            proxy: proxyConfig,
            headless: true,
            args: [
                '--start-maximized',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });

        const screenSize = getRandomScreenSize();
        const context = await browser.newContext({
            viewport: screenSize,
            locale: 'tr-TR',
            userAgent: getNextUserAgent(),
            bypassCSP: true,
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true
        });

        const pages = await Promise.all([
            context.newPage(),
            context.newPage()
        ]);

        stats.totalTabsActive += 2;
        return {
            browser,
            pages,
            proxyIp: proxyData.ip,
            startTime: Date.now(),
            lastActiveTime: Date.now()
        };
    } catch (error) {
        stats.browserErrors++;
        stats.sessionsFailed++;
        throw error;
    }
}
async function simulateInteraction(page) {
    try {
        // Wait for the page to be fully loaded first
        await Promise.race([
            Promise.all([
                page.waitForLoadState('domcontentloaded'),
                page.waitForLoadState('networkidle')
            ]),
            new Promise(r => setTimeout(r, 3000)) // Timeout after 30 seconds
        ]).catch(error => {
            logError('browser', 'pageLoad', error);
        });
 
        const endTime = Date.now() + CONFIG.SESSION_DURATION;
 
        // Initial interaction delay
        await page.waitForTimeout(Math.random() * 1000 + 500);
 
        while (Date.now() < endTime && !isShuttingDown) {
            // Fixed scroll functionality
            const scrollAmount = Math.floor(Math.random() * 300) + 100;
            const scrollDirection = Math.random() > 0.5;
           
            try {
                await page.evaluate(({ amount, scrollDown }) => {
                    window.scrollBy(0, scrollDown ? amount : -amount);
                }, { amount: scrollAmount, scrollDown: scrollDirection });
            } catch (error) {
                logError('browser', 'scrolling', error);
            }
 
            await page.waitForTimeout(Math.random() * 1000 + 500);
 
            // Try specific targets first
            try {
                const hasImage = await page.$('.attachment-bopea_large');
                if (hasImage) {
                    await Promise.race([
                        page.click('.attachment-bopea_large', { timeout: 5000 }),
                        new Promise(r => setTimeout(r, 5000))
                    ]);
                } else {
                    throw new Error('Image not found');
                }
            } catch (error) {
                try {
                    const hasTitle = await page.$('.jl_head_title');
                    if (hasTitle) {
                        await Promise.race([
                            page.click('.jl_head_title', { timeout: 5000 }),
                            new Promise(r => setTimeout(r, 5000))
                        ]);
                    } else {
                        throw new Error('Title not found');
                    }
                } catch (secondError) {
                    try {
                        // Fallback to any links on the page
                        const elements = await page.$$('a[href]');
                        if (elements.length > 0) {
                            const randomElement = elements[Math.floor(Math.random() * elements.length)];
                            await Promise.race([
                                randomElement.click({ timeout: 5000 }),
                                new Promise(r => setTimeout(r, 5000))
                            ]).catch(error => {
                                logError('browser', 'clicking', error);
                            });
                        } else {
                            logError('browser', 'clicking', new Error('No clickable elements found'));
                        }
                    } catch (randomError) {
                        logError('browser', 'clicking', randomError);
                    }
                }
            }
 
            // Mouse movement simulation
            try {
                const viewportSize = await page.viewportSize();
                if (viewportSize) {
                    const x = Math.floor(Math.random() * viewportSize.width);
                    const y = Math.floor(Math.random() * viewportSize.height);
                    await page.mouse.move(x, y);
                }
            } catch (error) {
                logError('browser', 'mouseMovement', error);
            }
 
            await page.waitForTimeout(Math.random() * 1000 + 500);
 
            // Occasionally reload the page (5% chance)
            if (Math.random() < 0.05) {
                try {
                    await Promise.race([
                        page.reload({ timeout: 3000 }),
                        new Promise(r => setTimeout(r, 3000))
                    ]);
                   
                    // Wait for load after reload
                    await Promise.race([
                        page.waitForLoadState('domcontentloaded'),
                        new Promise(r => setTimeout(r, 3000))
                    ]);
                } catch (error) {
                    logError('browser', 'navigation', error);
                }
            }

            // Check if page is still valid
            try {
                await page.evaluate(() => document.body);
            } catch (error) {
                logError('browser', 'pageValidation', error);
                break; // Exit the loop if page is no longer valid
            }
        }
    } catch (error) {
        logError('browser', 'navigation', error);
    } finally {
        try {
            // Ensure we clean up any listeners or states
            await page.evaluate(() => {
                window.stop(); // Stop any ongoing requests
            }).catch(() => {}); // Ignore errors in cleanup
        } catch (error) {
            // Ignore cleanup errors
        }
    }
}
// Enhanced group management
async function startNewGroup() {
    if (waitingForGroup.size >= CONFIG.GROUP_SIZE && !isShuttingDown) {
        const groupId = ++groupCounter;
        const groupSessions = Array.from(waitingForGroup).slice(0, CONFIG.GROUP_SIZE);
        
        groupSessions.forEach(session => waitingForGroup.delete(session));
        activeGroups.add(groupId);

        const groupPromises = groupSessions.map(async (session) => {
            try {
                await Promise.all(session.pages.map(simulateInteraction));
                stats.sessionsCompleted++;
                
                const replacementId = session.id + CONFIG.MAX_SESSIONS;
                sessionsInProgress.add(replacementId);
                
                if (!isShuttingDown) {
                    startNewSession(replacementId, session.proxyData);
                }
                
                await session.browser.close();
                stats.totalTabsActive -= 2;
                totalActiveSessions--;
                stats.activeSessionsCount--;
            } catch (error) {
                stats.browserErrors++;
                try {
                    await session.browser.close();
                } catch (e) {
                    stats.browserErrors++;
                }
                stats.totalTabsActive -= 2;
                totalActiveSessions--;
                stats.activeSessionsCount--;
                stats.sessionsFailed++;
                
                if (!isShuttingDown) {
                    const replacementId = session.id + CONFIG.MAX_SESSIONS;
                    sessionsInProgress.add(replacementId);
                    startNewSession(replacementId, session.proxyData);
                }
            }
        });

        await Promise.all(groupPromises).then(() => {
            activeGroups.delete(groupId);
            stats.groupsCompleted++;
        });
    }
}

async function startNewSession(sessionId, proxyData) {
    if (isShuttingDown || (!sessionsInProgress.has(sessionId) &&
        totalActiveSessions + sessionsInProgress.size >= CONFIG.MAX_SESSIONS)) {
        return;
    }

    try {
        totalActiveSessions++;
        stats.sessionsOpened++;

        const session = await createBrowserSession(proxyData);

        if (URLS.length >= 2) {
            await Promise.all([
                session.pages[0].goto(URLS[sessionId % URLS.length], { timeout: 60000 }).catch(() => {}),
                session.pages[1].goto(URLS[(sessionId + 1) % URLS.length], { timeout: 60000 }).catch(() => {})
            ]);
        }

        await Promise.all([
            session.pages[0].waitForLoadState("domcontentloaded").catch(() => {}),
            session.pages[1].waitForLoadState("domcontentloaded").catch(() => {})
        ]);

        stats.activeSessionsCount++;
        waitingForGroup.add({ id: sessionId, ...session, proxyData });
        sessionsInProgress.delete(sessionId);
        startNewGroup();
    } catch (error) {
        totalActiveSessions--;
        stats.sessionsFailed++;
        sessionsInProgress.delete(sessionId);

        if (totalActiveSessions + sessionsInProgress.size < CONFIG.MAX_SESSIONS && !isShuttingDown) {
            sessionsInProgress.add(sessionId);
            setTimeout(() => startNewSession(sessionId, proxyData), CONFIG.RETRY_DELAY);
        }
    }
}

// Resource monitoring
async function checkResources() {
    const memoryUsage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const memoryUsagePercent = memoryUsage.heapUsed / totalMemory;
    
    // Update stats
    stats.totalMemoryUsage = memoryUsage.heapUsed;
    return memoryUsagePercent > 0.85; // 85% threshold
}

// Cleanup function
async function cleanupSession(session) {
    try {
        await session.browser.close();
        stats.totalTabsActive -= 2;
        stats.activeSessionsCount--;
        waitingForGroup.delete(session);
    } catch (error) {
        stats.browserErrors++;
    }
}

// Periodic cleanup and monitoring
setInterval(async () => {
    if (isShuttingDown) return;
    
    const now = Date.now();
    // Clean up stale sessions
    for (const session of waitingForGroup) {
        if (now - session.lastActiveTime > CONFIG.SESSION_DURATION * 1.5) {
            await cleanupSession(session);
        }
    }
    
    // Memory management
    const memoryUsage = process.memoryUsage();
    if (memoryUsage.heapUsed > 1024 * 1024 * 1024) { // 1GB
        try {
            global.gc(); // Requires --expose-gc flag
        } catch (error) {
            // GC not available
        }
    }
}, CONFIG.CLEANUP_INTERVAL);

// Update dashboard periodically
setInterval(updateDashboard, CONFIG.DASHBOARD_UPDATE_INTERVAL);

// Graceful shutdown handler
async function handleShutdown() {
    console.log('\nInitiating graceful shutdown...');
    isShuttingDown = true;

    // Stop accepting new sessions
    sessionsInProgress.clear();

    // Cleanup all active sessions
    const cleanupPromises = Array.from(waitingForGroup).map(cleanupSession);
    await Promise.all(cleanupPromises);

    console.log('Final Stats:', stats);
    process.exit(0);
}

// Process error handlers
process.on('uncaughtException', (error) => {
    stats.browserErrors++;
    console.error('Uncaught Exception:', error);
    handleShutdown();
});

process.on('unhandledRejection', (error) => {
    stats.browserErrors++;
    console.error('Unhandled Rejection:', error);
});

process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

// Main function
async function main() {
    try {
        await loadUserAgents();
        const proxies = await loadProxies();
        process.stdout.write('\x1Bc');

        // Start periodic URL fetch
        scheduleURLFetch();

        const BATCH_SIZE = 50;
        const batches = Math.ceil(CONFIG.MAX_SESSIONS / BATCH_SIZE);

        for (let batch = 0; batch < batches; batch++) {
            if (isShuttingDown) break;

            const batchStart = batch * BATCH_SIZE;
            const batchPromises = [];

            for (let i = 0; i < BATCH_SIZE && (batchStart + i) < CONFIG.MAX_SESSIONS; i++) {
                const sessionId = batchStart + i;
                sessionsInProgress.add(sessionId);
                batchPromises.push(startNewSession(sessionId, proxies[sessionId % proxies.length]));
            }

            await Promise.all(batchPromises);
            await new Promise(resolve => setTimeout(resolve, 10));

            if (await checkResources()) {
                console.log('High resource usage detected, waiting before next batch...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        while (!isShuttingDown) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            const totalPending = totalActiveSessions + sessionsInProgress.size;
            if (totalPending < CONFIG.MAX_SESSIONS) {
                const needed = CONFIG.MAX_SESSIONS - totalPending;
                const promises = [];

                for (let i = 0; i < needed; i++) {
                    const sessionId = Date.now() + i;
                    sessionsInProgress.add(sessionId);
                    promises.push(startNewSession(sessionId, proxies[sessionId % proxies.length]));
                }

                await Promise.allSettled(promises);
            }
        }
    } catch (error) {
        stats.sessionsFailed++;
        console.error('Fatal error in main:', error);
        handleShutdown();
    }
}


// Start the application
main().catch((error) => {
    stats.sessionsFailed++;
    console.error('Application failed to start:', error);
    process.exit(1);
});