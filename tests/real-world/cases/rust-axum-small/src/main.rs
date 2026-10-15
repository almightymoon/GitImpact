use axum::{routing::get, Router};
mod tokens;

async fn list_users() -> String {
    tokens::issue()
}

#[tokio::main]
async fn main() {
    let app = Router::new().route("/users", get(list_users));
    let _ = app;
}
