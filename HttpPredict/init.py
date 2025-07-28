import azure.functions as func
import predict_server as p      # Flask app is in repo root

def main(req: func.HttpRequest, ctx: func.Context):
    return func.WsgiMiddleware(p.app).handle(req, ctx)
