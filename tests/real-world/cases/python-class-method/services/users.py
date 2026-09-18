class UserService:
    def get_user(self, user_id: str) -> dict | None:
        return {"id": user_id}

    def register(self, user_id: str) -> dict:
        existing = self.get_user(user_id)
        if existing:
            return existing
        return {"id": user_id, "created": True}


def bootstrap() -> dict:
    return UserService().register("user-1")
