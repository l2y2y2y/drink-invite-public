import json
import os
import time
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("DRINK_INVITE_E2E_URL", "http://localhost:8081/?ui=amber")
RUN_ID = str(int(time.time()))
TITLE = "端到端验收局-%s" % RUN_ID
HOST_NAME = "验收主理人-%s" % RUN_ID[-4:]
GUEST_NAME = "验收好友-%s" % RUN_ID[-4:]


def main():
    console_errors = []
    create_request = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        host_context = browser.new_context(viewport={"width": 1440, "height": 1100})
        host_page = host_context.new_page()
        host_page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error"
            else None,
        )

        def record_create_request(request):
            if request.method == "POST" and request.url.endswith("/api/v1/invites"):
                create_request["content_type"] = request.headers.get("content-type")
                create_request["body"] = request.post_data_json

        host_page.on("request", record_create_request)
        host_page.goto(BASE_URL, wait_until="load")
        host_page.get_by_role("button", name="确认主理人身份").first.click()
        host_page.locator("dialog input").fill(HOST_NAME)
        host_page.get_by_role("button", name="确认并登录").click()
        host_page.get_by_text("主理人身份已确认").wait_for()

        host_page.locator(".editor-panel .field-block input").nth(0).fill(TITLE)
        with host_page.expect_response(
            lambda response: response.url.endswith("/api/v1/invites")
            and response.request.method == "POST"
        ) as response_info:
            host_page.get_by_role("button", name="生成分享卡").click()
        create_response = response_info.value
        assert create_response.status == 200, create_response.text()
        assert create_request.get("content_type", "").startswith("application/json")
        assert create_request.get("body", {}).get("title") == TITLE
        host_page.get_by_text("新酒局已经做好，可以直接分享").wait_for()
        host_page.get_by_text(TITLE, exact=True).first.wait_for()

        share_url = host_page.url
        query = parse_qs(urlparse(share_url).query)
        assert query.get("invite"), share_url

        guest_context = browser.new_context(viewport={"width": 390, "height": 844})
        guest_page = guest_context.new_page()
        guest_page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error"
            else None,
        )
        guest_page.goto(share_url, wait_until="load")
        guest_page.get_by_text(TITLE, exact=True).first.wait_for()
        guest_page.locator(".guest-rsvp-card input").fill(GUEST_NAME)
        with guest_page.expect_response(
            lambda response: response.url.endswith("/rsvp")
            and response.request.method == "POST"
        ) as response_info:
            guest_page.get_by_role("button", name="提交回应").click()
        rsvp_response = response_info.value
        assert rsvp_response.status == 200, rsvp_response.text()
        guest_page.get_by_text("当前状态：pending").wait_for()

        host_page.reload(wait_until="load")
        host_page.get_by_text(GUEST_NAME, exact=True).wait_for()
        with host_page.expect_response(
            lambda response: response.url.endswith("/review")
            and response.request.method == "POST"
        ) as response_info:
            host_page.get_by_role("button", name="通过", exact=True).click()
        review_response = response_info.value
        assert review_response.status == 200, review_response.text()

        guest_page.reload(wait_until="load")
        guest_page.get_by_text("当前状态：approved").wait_for()
        assert not console_errors, console_errors

        result = {
            "base_url": BASE_URL,
            "title": TITLE,
            "share_url": share_url,
            "create_status": create_response.status,
            "content_type": create_request["content_type"],
            "rsvp_status": rsvp_response.status,
            "review_status": review_response.status,
            "guest_final_status": "approved",
            "console_errors": console_errors,
        }
        print(json.dumps(result, ensure_ascii=False))
        browser.close()


if __name__ == "__main__":
    main()
