$port = 3000
$root = $PSScriptRoot

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host ""
Write-Host "  Heartbound Dev Server running at:" -ForegroundColor Cyan
Write-Host "  http://localhost:$port" -ForegroundColor Green
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

$mimeTypes = @{
  ".html" = "text/html"
  ".css"  = "text/css"
  ".js"   = "application/javascript"
  ".json" = "application/json"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
  ".woff" = "font/woff"
  ".woff2"= "font/woff2"
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response

  $urlPath = $req.Url.AbsolutePath
  if ($urlPath -eq "/") { $urlPath = "/index.html" }

  $filePath = Join-Path $root $urlPath.TrimStart("/")

  if (Test-Path $filePath -PathType Leaf) {
    $ext = [System.IO.Path]::GetExtension($filePath)
    $mime = if ($mimeTypes[$ext]) { $mimeTypes[$ext] } else { "application/octet-stream" }
    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $res.ContentType = $mime
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    Write-Host "  200 $urlPath" -ForegroundColor DarkGray
  } else {
    $res.StatusCode = 404
    Write-Host "  404 $urlPath" -ForegroundColor Red
  }

  $res.OutputStream.Close()
}
