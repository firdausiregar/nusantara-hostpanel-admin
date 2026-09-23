# Hierarchical MVC

Setiap modul memiliki `model → service → controller → routes`. Controller/routes dilarang memanggil `child_process`, `sudo`, `hostpanelctl`, atau runtime privileged secara langsung. Privileged action hanya melalui runtime adapter dan helper root allowlist.
