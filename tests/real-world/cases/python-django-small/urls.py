from django.urls import path
from . import views

urlpatterns = [
    path("users/", views.users_index),
    path("users/<int:pk>/", views.user_detail),
]
