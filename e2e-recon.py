"""
Reconnaissance pass over the running app, per the webapp-testing skill.

Temporary: deleted after the run. It does not assert anything. Its job is to
walk the real flows a member walks, and write down what actually happens —
selectors, console errors, failed requests, and where a step could not be
completed. Assertions come after, when the selectors are known, because a test
written from a guess at the DOM tests the guess.
"""

import json
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"
with open("e2e-accounts.json", encoding="utf-8") as handle:
    ACCOUNTS = json.load(handle)

findings = []
console_errors = []
failed_requests = []


def note(step, detail):
    print(f"  {step}: {detail}", flush=True)
    findings.append({"step": step, "detail": detail})


def attach_listeners(page):
    page.on(
        "console",
        lambda msg: console_errors.append(
            {"type": msg.type, "text": msg.text[:300]}
        )
        if msg.type == "error"
        else None,
    )
    # Next cancels its own RSC prefetches on navigation; those aborts are
    # routine and would drown any real failure, so they are not collected.
    page.on(
        "requestfailed",
        lambda req: failed_requests.append(
            {"url": req.url[:160], "failure": (req.failure or "")[:160]}
        )
        if "_rsc=" not in req.url
        else None,
    )
    page.on(
        "response",
        lambda res: failed_requests.append(
            {"url": res.url[:160], "status": res.status}
        )
        if res.status >= 400
        else None,
    )


def sign_in(page, who):
    """Signs in and waits for the redirect to actually land.

    networkidle is not enough here: it returns while the button still reads
    "Signing in...", because the Supabase round trip and the server redirect
    that follows it are two separate waits. A screenshot taken at that moment
    shows the login form and reads as a broken login, which is what the first
    version of this script reported.
    """
    page.goto(f"{BASE}/login")
    page.wait_for_load_state("networkidle")
    page.fill("input[type=email]", ACCOUNTS[who]["email"])
    page.fill("input[type=password]", ACCOUNTS["password"])
    page.click("button[type=submit]")
    try:
        page.wait_for_url(lambda url: "/login" not in url, timeout=30000)
    except Exception:  # noqa: BLE001 - reported, not raised
        note("sign-in did not leave /login", page.locator("body").inner_text()[:200])
        return page.url
    page.wait_for_load_state("networkidle")
    return page.url


with sync_playwright() as p:
    # Uses the installed Chrome rather than downloading a second browser.
    browser = p.chromium.launch(headless=True, channel="chrome")

    # ---- 1. The login screen, as a stranger sees it --------------------------
    print("\n[1] login screen", flush=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    # with_server.py reports ready when the port accepts a connection, but
    # `next start` still has to serve its first request, which took about 25
    # seconds on this machine. Without a generous timeout and a warm-up the
    # first navigation times out and reads as a broken page rather than a cold
    # server. A stale server left holding the port produces the same symptom.
    page.set_default_navigation_timeout(120000)
    page.set_default_timeout(45000)
    attach_listeners(page)
    for _attempt in range(3):
        try:
            page.goto(f"{BASE}/login", wait_until="domcontentloaded")
            break
        except Exception:  # noqa: BLE001
            page.wait_for_timeout(5000)
    page.goto(f"{BASE}/login")
    page.wait_for_load_state("networkidle")
    note("title", page.title())
    note("email input", page.locator("input[type=email]").count())
    note("password input", page.locator("input[type=password]").count())
    note("submit button", page.locator("button[type=submit]").inner_text())
    page.screenshot(path=".playwright/01-login.png", full_page=True)

    # ---- 2. Signing in as the owner ----------------------------------------
    print("\n[2] sign in as owner", flush=True)
    landed = sign_in(page, "owner")
    note("landed on", landed)
    note("h1", page.locator("h1").first.inner_text() if page.locator("h1").count() else "(none)")
    page.screenshot(path=".playwright/02-dashboard.png", full_page=True)

    # ---- 3. What the dashboard offers --------------------------------------
    print("\n[3] dashboard controls", flush=True)
    for label in ["Upload documents", "Ask", "Messages", "Offline", "People"]:
        note(f"'{label}' present", page.get_by_text(label, exact=False).count() > 0)

    # ---- 4. Upload a document through the real UI ---------------------------
    # This is the flow that was failing in production: a file whose name
    # contains spaces. It exercises the signed-URL upload, the finalise route
    # and the storage-binding trigger together.
    print("\n[4] upload a file whose name contains spaces", flush=True)
    with open(".playwright/Board Notes 08 September.md", "w", encoding="utf-8") as handle:
        handle.write(
            "# Board Notes, 8 September\n\n"
            "SYNTHETIC TEST DOCUMENT for an automated run. Not an AIC record.\n\n"
            "The quarterly stipend was set at GHS 1,450 per participant.\n"
        )
    try:
        page.get_by_text("Upload documents", exact=False).first.click()
        page.wait_for_timeout(700)
        page.set_input_files("input[type=file]", ".playwright/Board Notes 08 September.md")
        page.wait_for_timeout(700)
        page.screenshot(path=".playwright/03-upload-staged.png", full_page=True)
        submit = page.get_by_role("button", name="Upload").first
        note("submit label", submit.inner_text())
        submit.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(3000)
        page.screenshot(path=".playwright/04-after-upload.png", full_page=True)
        body = page.locator("body").inner_text()
        note("upload succeeded", "Board Notes" in body)
        note("error text present", "Could not save" in body or "Queued offline" in body)
    except Exception as exc:  # noqa: BLE001 - reconnaissance records, never raises
        note("upload step failed", f"{type(exc).__name__}: {exc}")

    # ---- 5. The outsider ----------------------------------------------------
    print("\n[5] a second member, granted nothing", flush=True)
    other = browser.new_context(viewport={"width": 1440, "height": 900})
    other_page = other.new_page()
    other_page.set_default_navigation_timeout(120000)
    other_page.set_default_timeout(45000)
    attach_listeners(other_page)
    sign_in(other_page, "outsider")
    other_body = other_page.locator("body").inner_text()
    note("outsider sees the owner's document", "Board Notes" in other_body)
    other_page.screenshot(path=".playwright/05-outsider.png", full_page=True)

    # ---- 6. Pages a member can reach ---------------------------------------
    print("\n[6] every signed-in route", flush=True)
    for route in ["/dashboard", "/ask", "/messages", "/offline", "/account"]:
        other_page.goto(f"{BASE}{route}", timeout=60000)
        other_page.wait_for_load_state("networkidle")
        text = other_page.locator("body").inner_text()
        broke = "Something went wrong" in text or "could not be loaded" in text
        note(route, "ERROR PAGE" if broke else f"ok ({other_page.title()})")

    browser.close()

report = {
    "findings": findings,
    "console_errors": console_errors,
    "failed_requests": failed_requests,
}
with open(".playwright/recon.json", "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)

print(f"\nconsole errors: {len(console_errors)}")
for e in console_errors[:12]:
    print(f"  - {e['text'][:180]}")
print(f"failed requests/responses: {len(failed_requests)}")
for r in failed_requests[:12]:
    print(f"  - {r}")
