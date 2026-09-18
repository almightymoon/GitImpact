from authkit.tokens import hash_password


def issue_session(user_id: str, secret: str) -> str:
    return f"{user_id}:{hash_password(secret)}"
