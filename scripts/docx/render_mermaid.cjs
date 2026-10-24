// Renders Mermaid diagrams to PNG with a headless browser.
//   node render_mermaid.cjs jobs.json
// jobs.json: [{"code": "<mermaid source>", "out": "/abs/path.png"}, ...]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const MERMAID = process.env.MERMAID_JS || require.resolve('mermaid/dist/mermaid.min.js');

(async () => {
  const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1100, height: 800 } });
  await page.setContent('<html><body style="margin:0;background:#fff"><div id="c"></div></body></html>');
  await page.addScriptTag({ path: MERMAID });
  await page.evaluate(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      fontFamily: 'Calibri, Arial, sans-serif',
      themeVariables: {
        primaryColor: '#E6F2F1', primaryBorderColor: '#0F5E5E', primaryTextColor: '#123',
        lineColor: '#0F5E5E', secondaryColor: '#F6EBDD', tertiaryColor: '#FBF7F1',
        actorBkg: '#E6F2F1', actorBorder: '#0F5E5E', noteBkgColor: '#F6EBDD', noteBorderColor: '#C9A26B',
        pie1: '#0F5E5E', pie2: '#2E8B85', pie3: '#C9A26B', pie4: '#E0C49A', pie5: '#6FB7B0', pie6: '#8A6A3F',
        fontSize: '15px', pieOpacity: '1', pieStrokeColor: '#ffffff', pieOuterStrokeColor: '#ffffff', pieTitleTextColor: '#0F5E5E',
      },
      flowchart: { htmlLabels: true, curve: 'basis' },
    });
  });
  let i = 0;
  for (const job of jobs) {
    const svg = await page.evaluate(async ({ code, id }) => {
      const { svg } = await mermaid.render(id, code);
      document.getElementById('c').innerHTML = svg;
      return svg.length;
    }, { code: job.code, id: 'm' + (i++) });
    const el = await page.$('#c svg');
    fs.mkdirSync(path.dirname(job.out), { recursive: true });
    await el.screenshot({ path: job.out, omitBackground: false });
    process.stdout.write(`rendered ${path.basename(job.out)} (${svg} bytes svg)\n`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
