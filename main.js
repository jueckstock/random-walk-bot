'use strict'
const pptr = require('puppeteer-core')
const am = require('am')
const fs = require('fs/promises')
const rimraf = require('rimraf')
const PublicSuffixList = require('publicsuffixlist')
const Xvfb = require('xvfb')

const CHROME_EXE = process.env.CHROME_EXE || '/usr/bin/google-chrome'
const USER_AGENT = process.env.USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Safari/605.1.15';
const USE_XVFB = !!process.env.USE_XVFB
const NAV_TIMEOUT = 30.0 * 1000
const NAV_COMPLETE_EVENT = 'domcontentloaded'
const IDLE_TIME = 15.0 * 1000
const MAX_CRAWL_TIME = 250.0 * 1000


const LinkHarvester = (browser) => {
    const psl = new PublicSuffixList();
    psl.initializeSync();
    return async() => {
        const links = [];
        for (const page of await browser.pages()) {
            try {
                const pageUrl = new URL(page.url());
                const pageEtld1 = psl.domain(pageUrl.hostname);
                for (const aTag of await page.$$('a[href]')) {
                    const tagHref = await page.evaluate(a => a.href, aTag);
                    try {
                        const tagUrl = new URL(tagHref, pageUrl);
                        if (tagUrl.protocol.startsWith('http')) {
                            const tagEtld1 = psl.domain(tagUrl.hostname);
                            if (pageEtld1 !== tagEtld1) {
                                links.push({
                                    domain: tagEtld1,
                                    url: tagUrl.toString(),
                                    element: aTag,
                                    page: page,
                                });
                            }
                        }
                    } catch (err) {
                        console.error("link-harvesting href processing error:", err);
                    }
                }
            } catch (err) {
                console.error("link-harvesting page processing error:", err);
            }
        }
        return links;
    }
}

const closeOtherPages = async(browser, page) => {
    const allPages = await browser.pages()
    const pi = allPages.indexOf(page)
    if (pi < 0) {
        throw Error('no such page in browser')
    }
    allPages.splice(pi, 1)
    return Promise.all(allPages.map((p) => p.close()))
}

// The maximum is exclusive and the minimum is inclusive
function getRandomInt(min, max) {
    min = Math.ceil(min)
    max = Math.floor(max)
    return Math.floor(Math.random() * (max - min)) + min
}

function getRandomElement(array) {
    return array[getRandomInt(0, array.length)]
}


const timeoutIn = (ms) => new Promise((resolve, _) => { setTimeout(resolve, ms) });


const NavReporter = (browser) => {
    let nextTargetTag = 0;
    const targetTagMap = new Map();
    let traces = Object.create(null);

    browser.on('targetcreated', async(target) => {
        if (target.type() === 'page') {
            const tt = nextTargetTag++;
            targetTagMap.set(target, tt);
            traces[tt] = traces[tt] || [];
            traces[tt].push(target.url());

            const page = await target.page();
            /*page.on('response', response => {
                const request = response.request()
                if (request.isNavigationRequest() && (page.mainFrame() == request.frame())) {
                    traces[tt] = traces[tt] || [];
                    traces[tt].push(response.url());
                }
            });*/
            await page.setUserAgent(USER_AGENT);
        }
    })
    browser.on('targetchanged', (target) => {
        if (target.type() === "page") {
            const tt = targetTagMap.get(target);
            if (tt !== undefined) {
                traces[tt] = traces[tt] || [];
                traces[tt].push(target.url())
            }
        }
    })
    browser.on('targetdestroyed', (target) => {
        if (target.type() === "page") {
            targetTagMap.delete(target);
        }
    })

    return (referenceDocUrl, referencePage, clickedUrl) => {
        const data = traces;
        traces = Object.create(null);

        const target = referencePage.target();
        const tt = targetTagMap.get(target);
        if (tt in data) {
            const refData = data[tt];
            delete data[tt];
            data['clicked-tab'] = refData;
        }

        return {
            documentUrl: referenceDocUrl,
            clickedUrl,
            tabNavigations: data,
        }
    }
}

const doRandomCrawl = async(browser, seedUrl, traceQueue) => {
    const harvestLinks = LinkHarvester(browser);
    const navReport = NavReporter(browser);

    const page = await browser.newPage();
    const seedResponse = await page.goto(seedUrl, {
        timeout: NAV_TIMEOUT,
        waitUntil: NAV_COMPLETE_EVENT,
    })

    let lastDocUrl = "START";
    let lastUrl = seedUrl;
    let lastPage = page;
    while (true) {
        traceQueue.push(navReport(lastDocUrl, lastPage, lastUrl));
        const availableLinks = await harvestLinks();
        if (availableLinks.length === 0) {
            throw Error("hey, we ran outta links...");
        }
        const { domain, url: clickUrl, element, page } = getRandomElement(availableLinks);
        console.log(`picked a link to ${clickUrl} (eTLD+1: ${domain}) from page url=${page.url()}`);
        lastDocUrl = page.url();
        lastUrl = clickUrl;
        lastPage = page;
        await closeOtherPages(browser, page);
        await element.click();
        await timeoutIn(IDLE_TIME);
    }
}

am(async(seedUrl, traceLog) => {
    const tempDir = await fs.mkdtemp("rwb_")
    process.on('exit', () => {
        console.log(`wiping out temp dir: ${tempDir}`)
        rimraf.sync(tempDir)
    })

    let closeXvfb
    if (USE_XVFB) {
        const xServer = new Xvfb();
        xServer.startSync()
        closeXvfb = () => {
            console.log('tearing down Xvfb')
            xServer.stopSync()
        }
    } else {
        closeXvfb = () => {}
    }

    const browser = await pptr.launch({
        executablePath: CHROME_EXE,
        defaultViewport: null,
        userDataDir: tempDir,
        headless: false,
    })
    const traceQueue = [];

    try {
        await Promise.race([
            doRandomCrawl(browser, seedUrl, traceQueue),
            timeoutIn(MAX_CRAWL_TIME),
        ]);
    } catch (err) {
        console.error("crawl error:", err);
    } finally {
        await fs.writeFile(traceLog, JSON.stringify(traceQueue)).catch(err => console.error("trace log write error:", err));
        await browser.close().catch(err => console.error("browser shutdown error:", err));
        try {
            closeXvfb()
        } catch {}
        process.exit();
    }
})