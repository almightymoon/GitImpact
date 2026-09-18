from services.users import UserService, bootstrap


def main() -> dict:
    service = UserService()
    return service.register("user-1") if False else bootstrap()
