def list_users() -> list[dict]:
    return [{"id": 1}]


def get_user(pk: int) -> dict:
    return {"id": pk}
