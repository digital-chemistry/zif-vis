from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.wrappers import Response

from .app import create_app

PREFIX = "/zif"


def root_app(environ, start_response):
    response = Response("", status=302, headers={"Location": f"{PREFIX}/"})
    return response(environ, start_response)


application = DispatcherMiddleware(root_app, {PREFIX: create_app()})
