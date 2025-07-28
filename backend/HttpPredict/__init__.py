import azure.functions as func
import predict_server as p          # Flask app lives one folder up

def main(req: func.HttpRequest, ctx: func.Context):
    return func.WsgiMiddleware(p.app).handle(req, ctx)
