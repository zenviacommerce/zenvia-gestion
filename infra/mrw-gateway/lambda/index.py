import base64
import json
import os
import urllib.error
import urllib.request

ALLOWED_OPERATIONS = {"GetPointsDB", "TransmEnvio", "GetEtiquetaEnvio", "CancelarEnvio"}
PROD = "https://sagec.mrw.es/MRWEnvio.asmx"
TEST = "https://sagec-test.mrw.es/MRWEnvio.asmx"

def response(status, body):
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body),
    }

def lambda_handler(event, context):
    secret = os.environ.get("GATEWAY_SECRET", "")
    incoming = (event.get("headers") or {}).get("x-zenvia-gateway-key") or (event.get("headers") or {}).get("X-Zenvia-Gateway-Key")
    if not secret or incoming != secret:
        return response(401, {"error": "Unauthorized"})

    try:
        payload = json.loads(event.get("body") or "{}")
    except Exception:
        return response(400, {"error": "Invalid JSON"})

    environment = payload.get("environment") == "test" and "test" or "production"
    method = str(payload.get("method") or "POST").upper()
    base = TEST if environment == "test" else PROD

    if method == "GET":
        if payload.get("resource") != "wsdl":
            return response(400, {"error": "Unsupported GET resource"})
        request = urllib.request.Request(base + "?WSDL", method="GET", headers={
            "Accept": "text/xml,application/xml",
            "User-Agent": "ZENVIA-MRW-Gateway/1.0",
        })
    else:
        operation = str(payload.get("operation") or "")
        if operation not in ALLOWED_OPERATIONS:
            return response(400, {"error": "Unsupported MRW operation"})
        protocol = str(payload.get("soapVersion") or "1.1")
        envelope = str(payload.get("body") or "")
        if not envelope:
            return response(400, {"error": "Missing SOAP body"})
        action = f"http://www.mrw.es/{operation}"
        headers = {
            "Accept": "text/xml",
            "User-Agent": "ZENVIA-MRW-Gateway/1.0",
        }
        if protocol == "1.2":
            headers["Content-Type"] = f'application/soap+xml; charset=utf-8; action="{action}"'
        else:
            headers["Content-Type"] = "text/xml; charset=utf-8"
            headers["SOAPAction"] = f'"{action}"'
        request = urllib.request.Request(base, data=envelope.encode("utf-8"), method="POST", headers=headers)

    try:
        with urllib.request.urlopen(request, timeout=25) as upstream:
            raw = upstream.read()
            status = upstream.status
            content_type = upstream.headers.get("content-type", "")
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        status = exc.code
        content_type = exc.headers.get("content-type", "")
    except Exception as exc:
        return response(502, {"error": f"MRW upstream unavailable: {type(exc).__name__}"})

    return response(200, {
        "status": status,
        "contentType": content_type,
        "bodyBase64": base64.b64encode(raw).decode("ascii"),
    })
