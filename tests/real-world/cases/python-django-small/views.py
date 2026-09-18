from services.users import get_user, list_users as load_users


def users_index():
    return load_users()


def user_detail(pk: int):
    return get_user(pk)
