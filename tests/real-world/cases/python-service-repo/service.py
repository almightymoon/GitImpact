from repository import find_user, insert_user


def get_profile(user_id: str) -> dict | None:
    return find_user(user_id)


def create_profile(user_id: str) -> dict:
    existing = get_profile(user_id)
    if existing:
        return existing
    return insert_user({"id": user_id})
