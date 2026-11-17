// Picture Sheet in a real browser: good pictures are taken, and hostile or
// broken files are turned away without an error, a dialog or a stalled page.
// Run with the smoke tests (`npm run test:smoke`).

// Code passed to page.evaluate runs in the browser, with the browser's globals.
/* global document, DataTransfer, DragEvent, ClipboardEvent */

import { expect, test } from "@playwright/test";

const URL_ = "/apps/picture-sheet/";
const MB = 1024 * 1024;

/**
 * Open the app with the welcome window already seen, collecting errors and
 * failing on any dialog (an `alert` from a hostile file would open one).
 *
 * @param {import("@playwright/test").Page} page
 */
async function open(page) {
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => {
    errors.push("dialog: " + d.message());
    d.dismiss().catch(() => {});
  });
  // Nothing but the page itself and its fonts.
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return ["127.0.0.1", "fonts.googleapis.com", "fonts.gstatic.com"].includes(host)
      ? route.continue()
      : route.abort();
  });
  await page.addInitScript(() => localStorage.setItem("geo-apps.welcome.picture-sheet", "1"));
  await page.goto(URL_);
  return errors;
}

/**
 * Make a picture in the page: a gradient with a few shapes, as PNG, JPEG or WebP.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} type
 * @param {number} w
 * @param {number} h
 * @returns {Promise<Buffer>}
 */
async function makePicture(page, type, w, h) {
  const b64 = await page.evaluate(
    async ([type, w, h]) => {
      const c = document.createElement("canvas");
      c.width = /** @type {number} */ (w);
      c.height = /** @type {number} */ (h);
      const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
      const g = ctx.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, "#2a6f97");
      g.addColorStop(1, "#e9c46a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = "#264653";
      ctx.fillRect(c.width * 0.2, c.height * 0.5, c.width * 0.3, c.height * 0.4);
      const blob = /** @type {Blob} */ (
        await new Promise((r) => c.toBlob(r, /** @type {string} */ (type), 0.9))
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (const x of bytes) s += String.fromCharCode(x);
      return btoa(s);
    },
    [type, w, h],
  );
  return Buffer.from(b64, "base64");
}

/** A 1 × 1 GIF. */
const GIF = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

/** @param {Buffer} png @param {number} w @param {number} h a PNG whose header says w × h */
function patchPngSize(png, w, h) {
  const b = Buffer.from(png);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {Array<{name: string, mimeType: string, buffer: Buffer}>} files
 */
async function choose(page, files) {
  await page.locator("#fileInput").setInputFiles(files);
}

const trayCount = (/** @type {import("@playwright/test").Page} */ page) =>
  page.locator("#trayCount");

test("good pictures go on the sheet, and the sheet exports", async ({ page }) => {
  const errors = await open(page);
  const files = [
    {
      name: "harbour.png",
      mimeType: "image/png",
      buffer: await makePicture(page, "image/png", 900, 600),
    },
    {
      name: "street.jpg",
      mimeType: "image/jpeg",
      buffer: await makePicture(page, "image/jpeg", 600, 900),
    },
    {
      name: "hill.webp",
      mimeType: "image/webp",
      buffer: await makePicture(page, "image/webp", 1200, 500),
    },
    { name: "dot.gif", mimeType: "image/gif", buffer: GIF },
  ];
  await choose(page, files);
  await expect(trayCount(page)).toHaveText("4 pictures · 4 of 12 on the sheet");
  await expect(page.locator("#sheetWrap")).toBeVisible();
  await expect(page.locator("#problems")).toBeHidden();

  // Labels and numbers, a move, then take one off the sheet.
  await page.locator("#trayGrid .tile input.label").first().fill("Lisbon");
  await page.locator("#optNumbers").check();
  await page.getByRole("button", { name: "Move later" }).first().click();
  await expect(page.locator("#trayGrid .tile").nth(1).locator("input.label")).toHaveValue("Lisbon");
  await page.locator("#trayGrid .tile .thumb").first().click();
  await expect(trayCount(page)).toHaveText("4 pictures · 3 of 12 on the sheet");

  const [png] = await Promise.all([page.waitForEvent("download"), page.click("#dlPng")]);
  expect(png.suggestedFilename()).toMatch(/^picture-sheet-[a-z0-9]+\.png$/);
  const bytes = await (await png.createReadStream()).toArray();
  expect(Buffer.concat(bytes).subarray(1, 4).toString()).toBe("PNG");

  await page.getByRole("button", { name: "Remove this picture" }).first().click();
  await expect(trayCount(page)).toHaveText("3 pictures · 3 of 12 on the sheet");
  await page.click("#clearAll");
  await expect(trayCount(page)).toHaveText("");
  await expect(page.locator("#sheetWrap")).toBeHidden();
  expect(errors).toEqual([]);
});

test("hostile and broken files are turned away, each with a reason", async ({ page }) => {
  const errors = await open(page);
  const real = await makePicture(page, "image/png", 300, 300);
  const files = [
    {
      name: "innocent.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>',
      ),
    },
    {
      name: "page.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("<html><script>alert(3)</script></html>"),
    },
    // A PNG header declaring 40,000 × 40,000 pixels, in a tiny file.
    { name: "bomb.png", mimeType: "image/png", buffer: patchPngSize(real, 40_000, 40_000) },
    // A JPEG start and a frame header, then nonsense.
    {
      name: "broken.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 100, 0, 100, 3]),
        Buffer.alloc(4000, 0x5a),
      ]),
    },
    // A real PNG whose header lies about its size.
    { name: "liar.png", mimeType: "image/png", buffer: patchPngSize(real, 10, 10) },
    { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) },
    { name: "huge.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(41 * MB, 0) },
    {
      name: '<img src=x onerror="alert(4)">.png',
      mimeType: "image/png",
      buffer: Buffer.from("<svg/>"),
    },
    // One good picture among them.
    { name: "fine.png", mimeType: "image/png", buffer: real },
  ];
  await choose(page, files);
  await expect(trayCount(page)).toHaveText("1 picture · 1 of 12 on the sheet");
  const problems = page.locator("#problems li");
  await expect(problems).toHaveCount(8);
  const text = (await problems.allTextContents()).join("\n");
  expect(text).toContain("innocent.png: It isn't a JPEG, PNG, GIF or WebP picture.");
  expect(text).toContain("page.jpg: It isn't a JPEG, PNG, GIF or WebP picture.");
  expect(text).toMatch(/bomb\.png: It is too large \(40,000 × 40,000 pixels\)/);
  expect(text).toMatch(/broken\.jpg: The browser couldn't open it/);
  expect(text).toMatch(/liar\.png: (The browser couldn't open it|It doesn't match its own header)/);
  expect(text).toContain("empty.png: It is too short to be a picture.");
  expect(text).toContain("huge.jpg: It is larger than 40 MB.");
  // A file name is shown as text, never as markup.
  expect(text).toContain('<img src=x onerror="alert(4)">.png');
  expect(await page.locator("img").count()).toBe(0);
  expect(errors).toEqual([]);
});

test("no more than 60 pictures are kept", async ({ page }) => {
  const errors = await open(page);
  const one = await makePicture(page, "image/png", 40, 30);
  const files = Array.from({ length: 65 }, (_, i) => ({
    name: `p${i}.png`,
    mimeType: "image/png",
    buffer: one,
  }));
  await choose(page, files);
  await expect(trayCount(page)).toHaveText("60 pictures · 12 of 12 on the sheet", {
    timeout: 30_000,
  });
  await expect(page.locator("#problems")).toContainText("5 pictures were left out");
  await choose(page, [{ name: "more.png", mimeType: "image/png", buffer: one }]);
  await expect(page.locator("#problems")).toContainText("1 picture was left out");
  // A 13th on the sheet is refused politely.
  await page.locator("#trayGrid .tile:not(.on) .thumb").first().click();
  await expect(page.locator("#note")).toContainText("12 is as many as fit on one sheet");
  expect(errors).toEqual([]);
});

test("pictures can be dropped or pasted, and a file dropped beside the zone doesn't replace the page", async ({
  page,
}) => {
  const errors = await open(page);
  const b64 = (await makePicture(page, "image/png", 120, 80)).toString("base64");
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = (/** @type {string} */ name) => new File([bytes], name, { type: "image/png" });
    const drop = new DataTransfer();
    drop.items.add(file("dropped.png"));
    // Dropped on the sheet's side of the page, not on the drop zone.
    document
      .querySelector(".rail")
      ?.dispatchEvent(
        new DragEvent("drop", { dataTransfer: drop, bubbles: true, cancelable: true }),
      );
    const paste = new DataTransfer();
    paste.items.add(file("pasted.png"));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: paste, bubbles: true }));
  }, b64);
  await expect(trayCount(page)).toHaveText("2 pictures · 2 of 12 on the sheet");
  await expect(page).toHaveURL(new RegExp(URL_.replace(/\//g, "\\/") + "$"));
  expect(errors).toEqual([]);
});

test("a photo's hidden details don't reach the exported sheet", async ({ page }) => {
  const errors = await open(page);
  const jpeg = await makePicture(page, "image/jpeg", 800, 600);
  // An EXIF block after the JPEG's start, with a location in it.
  const secret = Buffer.from("Exif\0\0GPSLatitude 38.7223 N secret-location-marker");
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    Buffer.from([0, secret.length + 2]),
    secret,
  ]);
  const withExif = Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
  await choose(page, [{ name: "holiday.jpg", mimeType: "image/jpeg", buffer: withExif }]);
  await expect(trayCount(page)).toHaveText("1 picture · 1 of 12 on the sheet");
  for (const id of ["#dlPng", "#dlJpg"]) {
    const [d] = await Promise.all([page.waitForEvent("download"), page.click(id)]);
    const out = Buffer.concat(await (await d.createReadStream()).toArray());
    expect(out.includes("secret-location-marker")).toBe(false);
    expect(out.includes("GPSLatitude")).toBe(false);
    expect(d.suggestedFilename()).not.toContain("holiday");
  }
  expect(errors).toEqual([]);
});

test("a very large photo is taken, kept smaller, and the page stays responsive", async ({
  page,
}) => {
  const errors = await open(page);
  // 48 megapixels, close to the limit: what a high-end phone takes.
  const big = await makePicture(page, "image/jpeg", 8000, 6000);
  await choose(page, [{ name: "big.jpg", mimeType: "image/jpeg", buffer: big }]);
  await expect(trayCount(page)).toHaveText("1 picture · 1 of 12 on the sheet", { timeout: 30_000 });
  // The thumbnail is small, and the page still answers.
  const thumb = page.locator("#trayGrid canvas.pic");
  expect(await thumb.evaluate((c) => Math.max(c.width, c.height))).toBeLessThanOrEqual(240);
  await page.locator("#optNumbers").check();
  await expect(page.locator("#sheetWrap")).toBeVisible();
  expect(errors).toEqual([]);
});

/**
 * A picture whose left half is red and right half blue, as PNG.
 *
 * @param {import("@playwright/test").Page} page
 */
async function halves(page) {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1000;
    c.height = 500;
    const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 500, 500);
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(500, 0, 500, 500);
    const blob = /** @type {Blob} */ (await new Promise((r) => c.toBlob(r, "image/png")));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  });
  return Buffer.from(b64, "base64");
}

/**
 * How much clear red and clear blue the sheet shows.
 *
 * @param {import("@playwright/test").Page} page
 */
const sheetColours = (page) =>
  page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById("sheet"));
    const d = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d")).getImageData(
      0,
      0,
      c.width,
      c.height,
    ).data;
    let red = 0;
    let blue = 0;
    for (let i = 0; i < d.length; i += 16) {
      if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++;
      if (d[i + 2] > 200 && d[i] < 60 && d[i + 1] < 60) blue++;
    }
    return { red, blue };
  });

test("a crop puts only the part marked on the sheet, and can be taken back", async ({ page }) => {
  const errors = await open(page);
  await choose(page, [{ name: "halves.png", mimeType: "image/png", buffer: await halves(page) }]);
  await expect(trayCount(page)).toHaveText("1 picture · 1 of 12 on the sheet");
  await expect.poll(async () => (await sheetColours(page)).red).toBeGreaterThan(1000);

  await page.getByRole("button", { name: "Crop: use only part of this picture" }).click();
  const dialog = page.locator("#cropper");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#cropUse")).toBeDisabled();

  // A click without a drag marks nothing.
  const box = /** @type {{x: number, y: number, width: number, height: number}} */ (
    await page.locator("#cropCanvas").boundingBox()
  );
  const P = (/** @type {number} */ fx, /** @type {number} */ fy) => [
    box.x + box.width * fx,
    box.y + box.height * fy,
  ];
  await page.mouse.click(...P(0.3, 0.3));
  await expect(page.locator("#cropSel")).toBeHidden();
  await expect(page.locator("#cropUse")).toBeDisabled();

  // Mark part of the blue half.
  await page.mouse.move(...P(0.6, 0.1));
  await page.mouse.down();
  await page.mouse.move(...P(0.8, 0.5), { steps: 5 });
  await page.mouse.move(...P(0.95, 0.9), { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#cropSel")).toBeVisible();
  // About 350 × 400 pixels; a pointer lands between pixels.
  await expect(page.locator("#cropInfo")).toContainText(/The part marked: 35\d × 40\d pixels/);
  await page.click("#cropUse");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#trayGrid .tile.cropped")).toHaveCount(1);
  await expect.poll(async () => (await sheetColours(page)).red).toBe(0);
  expect((await sheetColours(page)).blue).toBeGreaterThan(1000);

  // Drag the part onto the red half: the sheet follows.
  await page.getByRole("button", { name: "Crop: use only part of this picture" }).click();
  await expect(page.locator("#cropSel")).toBeVisible();
  await page.mouse.move(...P(0.75, 0.5));
  await page.mouse.down();
  await page.mouse.move(...P(0.1, 0.5), { steps: 8 });
  await page.mouse.up();
  await page.click("#cropUse");
  await expect.poll(async () => (await sheetColours(page)).blue).toBe(0);

  // Cancel changes nothing; "Use the whole picture" brings it all back.
  await page.getByRole("button", { name: "Crop: use only part of this picture" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#trayGrid .tile.cropped")).toHaveCount(1);
  await page.getByRole("button", { name: "Crop: use only part of this picture" }).click();
  await expect(dialog).toBeVisible();
  await page.click("#cropWhole");
  await expect(page.locator("#trayGrid .tile.cropped")).toHaveCount(0);
  await expect.poll(async () => (await sheetColours(page)).red).toBeGreaterThan(1000);
  expect((await sheetColours(page)).blue).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test("the crop can be marked and sized with the keyboard, and a small part is flagged", async ({
  page,
}) => {
  const errors = await open(page);
  await choose(page, [{ name: "halves.png", mimeType: "image/png", buffer: await halves(page) }]);
  await expect(trayCount(page)).toHaveText("1 picture · 1 of 12 on the sheet");
  await page.getByRole("button", { name: "Crop: use only part of this picture" }).click();
  await expect(page.locator("#cropStage")).toBeFocused();
  await page.keyboard.press("ArrowRight"); // marks the middle
  await expect(page.locator("#cropInfo")).toContainText("500 × 250 pixels");
  for (let i = 0; i < 40; i++) await page.keyboard.press("Shift+ArrowLeft");
  await expect(page.locator("#cropInfo")).toContainText("That's small");
  await page.keyboard.press("Tab"); // through the buttons to "Use this part"
  await page.click("#cropUse");
  await expect(page.locator("#trayGrid .tile.cropped")).toHaveCount(1);
  expect(errors).toEqual([]);
});
