def issue_token(user_id: str) -> str:
    return f"token-{user_id}"


def verify_token(token: str) -> bool:
    return token.startswith("token-")


def require_auth(token: str) -> bool:
    return verify_token(token)
