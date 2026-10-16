<#
  Read a SiYuan notebook (Docker edition) and emit Markdown.

  Source is the raw .sy block tree in the container bind mount
  (D:\ai-shared-db\new folder). SiYuan writes .sy to disk on every save, so
  each call already returns the latest content -- no sync step needed.

  NOTE: this file must stay pure ASCII. Windows PowerShell 5.1 parses a
  BOM-less script as GBK, which corrupts non-ASCII string literals.

  Usage (from D:\chumao-diary, i.e. the project root):
    powershell -NoProfile -File scripts\siyuan-notes.ps1            # list notebooks
    powershell -NoProfile -File scripts\siyuan-notes.ps1 -List      # list docs in the notebook
    powershell -NoProfile -File scripts\siyuan-notes.ps1 -Doc 08    # export one doc (title/ID fragment, repeatable)
    powershell -NoProfile -File scripts\siyuan-notes.ps1 -All       # export the whole notebook
#>
param(
  [string]  $Workspace = 'D:\ai-shared-db\new folder',
  [string]  $Notebook  = '20261012012311-76i3oj6',   # notebook ID; name match works too
  [string[]]$Doc,
  [switch]  $List,
  [switch]  $All
)
$ErrorActionPreference = 'Stop'

function Get-Notebooks {
  Get-ChildItem (Join-Path $Workspace 'data') -Directory |
    Where-Object Name -match '^\d{14}-' |
    ForEach-Object {
      $conf = Join-Path $_.FullName '.siyuan\conf.json'
      $name = if (Test-Path $conf) { (Get-Content $conf -Raw -Encoding UTF8 | ConvertFrom-Json).name } else { $_.Name }
      [pscustomobject]@{ Id = $_.Name; Name = $name; Path = $_.FullName }
    }
}

function Get-Docs([string]$nbPath) {
  Get-ChildItem $nbPath -Recurse -Filter *.sy | Sort-Object Name | ForEach-Object {
    $json = Get-Content $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    [pscustomobject]@{
      Id    = $_.BaseName
      Title = if ($json.Properties.title) { $json.Properties.title } else { $_.BaseName }
      Json  = $json
    }
  }
}

# inline nodes -> Markdown
function Get-Inline($n) {
  $s = ''
  foreach ($c in $n.Children) {
    switch ($c.Type) {
      'NodeText'     { $s += $c.Data }
      'NodeTextMark' {
        $t = $c.TextMarkTextContent
        $mark = switch ($c.TextMarkType) {
          'strong'      { "**$t**" }
          'em'          { "*$t*" }
          'strike'      { "~~$t~~" }
          'code'        { '`' + $t + '`' }
          'tag'         { "#$t#" }
          'inline-math' { '$' + $t + '$' }
          default       { $t }
        }
        $s += $mark
      }
      'NodeImage'    { $s += '![' + $c.Data + '](' + $c.Properties.src + ')' }
      'NodeLink'     { $s += '[' + $c.Data + '](' + $c.Properties.href + ')' }
      default        { $s += Get-Inline $c }
    }
  }
  $s
}

$script:sb = New-Object System.Text.StringBuilder
function Emit([string]$line) { [void]$script:sb.AppendLine($line) }

function Write-Block($n, [string]$indent = '') {
  switch ($n.Type) {
    'NodeHeading'   { Emit ''; Emit (('#' * [int]$n.HeadingLevel) + ' ' + (Get-Inline $n)) }
    'NodeParagraph' { Emit ($indent + (Get-Inline $n)) }
    'NodeCodeBlock' { Emit ''; Emit ('```' + $n.Properties.language); Emit $n.Data; Emit '```' }
    'NodeThematicBreak' { Emit '---' }
    'NodeList' {
      $i = 0
      foreach ($li in $n.Children) {
        $i++
        $marker = if ($n.ListData.Type -eq 'o') { "$i. " } else { '- ' }
        $first = $true
        foreach ($c in $li.Children) {
          if ($first) { Write-Block $c ($indent + $marker); $first = $false }
          else        { Write-Block $c ($indent + '  ') }
        }
      }
    }
    'NodeTable' {
      # NodeTableHead / NodeTableRow / NodeTableCell carry only the tag name
      # (thead/tr/th/td) in Data; the real content is in their Children. The
      # head row sits one level deeper than the body rows, so flatten first.
      $rows = @()
      foreach ($child in $n.Children) {
        if ($child.Type -eq 'NodeTableHead') { $rows += $child.Children } else { $rows += $child }
      }
      Emit ''
      $k = 0
      foreach ($row in $rows) {
        $cells = @(foreach ($cell in $row.Children) { (Get-Inline $cell).Trim() })
        Emit ('| ' + ($cells -join ' | ') + ' |')
        if ($k -eq 0) { Emit ('|' + (' --- |' * $cells.Count)) }
        $k++
      }
      Emit ''
    }
    # ponytail: blockquotes lose their '>' prefix and just recurse; the archived
    # docs here barely use them, so a quote-aware branch is not worth it yet.
    default { foreach ($c in $n.Children) { Write-Block $c $indent } }
  }
}

$notebooks = @(Get-Notebooks)
if (-not $Doc -and -not $List -and -not $All) {
  $notebooks | ForEach-Object { "{0}`t{1}" -f $_.Id, $_.Name }
  return
}

$nb = $notebooks | Where-Object { $_.Name -eq $Notebook -or $_.Id -eq $Notebook } | Select-Object -First 1
if (-not $nb) { throw "Notebook '$Notebook' not found. Run without arguments to list notebooks." }

$docs = @(Get-Docs $nb.Path)
if ($List) {
  $docs | ForEach-Object { "{0}`t{1}" -f $_.Id, $_.Title }
  return
}

$selected = if ($All) { $docs } else {
  $docs | Where-Object {
    $d = $_
    @($Doc | Where-Object { $d.Title -like "*$_*" -or $d.Id -like "$_*" }).Count -gt 0
  }
}
if (-not $selected) { throw "No document in '$Notebook' matches -Doc $($Doc -join ',')." }

foreach ($d in $selected) {
  Emit ''
  Emit ('=' * 60)
  Emit ('DOC: ' + $d.Title)
  Emit ('=' * 60)
  Write-Block $d.Json ''
}
$script:sb.ToString()
