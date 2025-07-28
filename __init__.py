import azure.functions as func
import predict_server as p          # Flask app is in the same directory

def main(req: func.HttpRequest, ctx: func.Context):
    """Azure entry‑point – forward to the Flask WSGI app."""
    return func.WsgiMiddleware(p.app).handle(req, ctx)
