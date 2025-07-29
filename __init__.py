import os
import openai
import azure.functions as func
from azure.functions import WsgiMiddleware
import predict_server as p      # your Flask app from predict_server.py

# Grab your OpenAI key from an environment variable
openai.api_key = os.getenv("OPENAI_API_KEY")

def main(req: func.HttpRequest, ctx: func.Context) -> func.HttpResponse:
    """
    - if path starts with /api/chat → handle here with OpenAI
    - otherwise → forward into your Flask app
    """

    # extract the “raw” path part of the URL (requires function.json route = "{*route}")
    route = req.route_params.get("route", "") or ""
    route = route.lstrip("/").lower()

    if route.startswith("api/chat"):
        # --- OpenAI Chat handler ---
        body = req.get_json(silent=True) or {}
        prompt = body.get("prompt", "")
        if not prompt:
            return func.HttpResponse(
                json.dumps({"error": "missing 'prompt' field"}),
                status_code=400,
                mimetype="application/json",
            )

        try:
            resp = openai.ChatCompletion.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.choices[0].message.content
            return func.HttpResponse(text, status_code=200)
        except Exception as e:
            return func.HttpResponse(
                json.dumps({"error": str(e)}),
                status_code=500,
                mimetype="application/json",
            )

    else:
        # --- Everything else goes to your Flask app ---
        return WsgiMiddleware(p.app).handle(req, ctx)
