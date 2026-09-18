from flask import Flask
from services.auth import issue_token, verify_token

app = Flask(__name__)


@app.post("/login")
def login():
    token = issue_token("user-1")
    return {"token": token}


@app.get("/me")
def me():
    ok = verify_token("token-user-1")
    return {"ok": ok}
