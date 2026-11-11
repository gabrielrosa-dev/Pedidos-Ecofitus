$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$products = [System.Collections.Generic.List[object]]::new()
$page = 0
do {
    $body = @{ cnpj = '23624691000108'; distributorId = 3; pagina = $page } | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Uri 'https://ic.nexfar.com.br/api/catalog/2773/products' `
        -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
    if ($null -eq $result.products -or $null -eq $result.totalPaginas -or
        $result.totalPaginas -lt 1 -or $result.totalPaginas -gt 1000 -or $result.pagina -ne $page) {
        throw "Resposta inválida na página $page do catálogo."
    }
    foreach ($product in $result.products) { $products.Add($product) }
    $page++
} while ($page -lt $result.totalPaginas)

@{ products = @($products.ToArray()) } | ConvertTo-Json -Depth 30 -Compress
