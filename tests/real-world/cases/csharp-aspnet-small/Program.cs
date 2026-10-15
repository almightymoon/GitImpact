using Microsoft.AspNetCore.Builder;
using Example.Services;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/users", () => TokenService.Issue());
app.Run();
