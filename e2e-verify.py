"""
Focused checks on the three things the reconnaissance pass flagged.

Temporary: deleted after the run. Each is checked after the page has actually
settled, because the first pass produced two contradictory readings — the same
control reported absent in one step and clicked successfully in the next —
which is the signature of asserting against a page mid-hydration.
"""

import json
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"
with open("e2e-accounts.json", encoding="utf-8") as handle:
    ACCOUNTS = json.load(handle)

results = {}


def check(name, value):
    results[name] = value
    print(f"  {name}: {value}", flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="chrome")
    page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
    page.set_default_navigation_timeout(120000)
    page.set_default_timeout(45000)

    for _ in range(3):
        try:
            page.goto(f"{BASE}/login", wait_until="domcontentloaded")
            break
        except Exception:  # noqa: BLE001
            page.wait_for_timeout(5000)

    page.fill("input[type=email]", ACCOUNTS["owner"]["email"])
    page.fill("input[type=password]", ACCOUNTS["password"])
    page.click("button[type=submit]")
    page.wait_for_url(lambda url: "/login" not in url)
    page.wait_for_load_state("networkidle")
    # Settle past hydration before asserting anything about the DOM.
    page.wait_for_timeout(2500)

    print("\n[A] heading structure on /dashboard", flush=True)
    check("h1 count", page.locator("h1").count())
    if page.locator("h1").count():
        check("h1 text", page.locator("h1").first.inner_text())
    check("h2 count", page.locator("h2").count())
    headings = page.evaluate(
        "() => Array.from(document.querySelectorAll('h1,h2,h3'))"
        ".map(h => h.tagName + ':' + h.textContent.trim().slice(0,40))"
    )
    check("headings", headings[:8])

    print("\n[B] the upload control", flush=True)
    check("exact text 'Upload documents'", page.get_by_text("Upload documents", exact=True).count())
    check("role=button name~Upload", page.get_by_role("button", name="Upload").count())
    buttons = page.evaluate(
        "() => Array.from(document.querySelectorAll('button'))"
        ".map(b => b.textContent.trim().slice(0,30)).filter(Boolean)"
    )
    check("all buttons", buttons[:10])

    print("\n[C] page titles across routes", flush=True)
    titles = {}
    for route in ["/dashboard", "/ask", "/messages", "/offline", "/account"]:
        page.goto(f"{BASE}{route}")
        page.wait_for_load_state("networkidle")
        titles[route] = page.title()
    for route, title in titles.items():
        # repr so a non-ASCII separator is visible rather than mangled by the
        # terminal's own encoding, which is what made this look like mojibake.
        check(f"title {route}", repr(title))
    results["titles"] = titles

    print("\n[D] landmarks and skip link", flush=True)
    page.goto(f"{BASE}/dashboard")
    page.wait_for_load_state("networkidle")
    check("main landmark", page.locator("main").count())
    check("nav landmark", page.locator("nav").count())
    check("skip link", page.get_by_text("Skip to content", exact=False).count())

    browser.close()

with open(".playwright/verify.json", "w", encoding="utf-8") as handle:
    json.dump(results, handle, indent=2, ensure_ascii=False)
print("\nwrote .playwright/verify.json")
