but yesterday we did the&#x20;

# Remote Development Environment — Architecture & Workflow

## Overview

The development environment consists of two Ubuntu-based computers connected over a local network using SSH and SSHFS.



The **Lenovo laptop serves as the primary development workstation**, while the **main Ubuntu computer serves as the project host and execution/testing environment**.



The objective is to enable remote development of selected applications without granting the Lenovo unrestricted access to the main computer's filesystem.

## System Architecture

### 1. Lenovo Laptop — Development Workstation

- **Hostname/User:** `glenn`
- **IP Address:** `192.168.178.37`
- **Role:** Primary development environment
- **Connection:** SSHFS over SSH/SFTP

The Lenovo is responsible for:

- Editing and modifying application source code.
- Performing development tasks using IDEs, terminals, and AI coding agents.
- Accessing designated project directories through SSHFS mounts.
- Saving changes directly to the original project files hosted on the main computer.

### 2. Main Ubuntu Computer — Project Host

- **Hostname:** `gayzer-NUC11DBBi9`
- **Username:** `gayzer`
- **IP Address:** `192.168.178.23`
- **Role:** Central project storage, application execution, and testing

The main computer is responsible for:

- Maintaining the original project repositories.
- Providing restricted project access through SSH/SFTP.
- Executing and testing applications in the target Ubuntu environment.
- Preserving isolation between development projects and unrelated personal files.

## Shared Project Directories

Only two projects are designated for remote development.

### Media Viewer

**Original host directory:**\
`/home/gayzer/Apps/media-viewer/gayzer_media_player/gayzer_media_viewer`



**Restricted SFTP directory:**\
`/media-viewer`



**Lenovo mount location:**\
`/home/glenn/Projects/media-viewer`

### Hermes Life

**Original host directory:**\
`/home/gayzer/Apps/hermes-life`



**Restricted SFTP directory:**\
`/hermes-life`



**Lenovo mount location:**\
`/home/glenn/Projects/hermes-life`



Both projects are exposed through Linux bind mounts and accessed remotely using SSHFS.



These are live filesystem mounts, not independent copies or synchronized repositories.



Changes made from the Lenovo are written directly to the original project files on the main Ubuntu computer.

## Security and Access Restrictions

A dedicated account named `devshare` is configured on the main computer.



The account uses:

- **SSH chroot directory:** `/srv/devshare`
- **SFTP-only access:** `ForceCommand internal-sftp`
- **No interactive SSH shell**
- **No SSH port forwarding**
- **No X11 forwarding**
- **Project-specific filesystem permissions**

The purpose of this configuration is to prevent remote development tools and AI coding agents using the `devshare` connection from accessing unrelated files outside the designated project directories.



The isolation applies to the restricted `devshare` connection, not to other SSH accounts or credentials.

## Development Workflow

1. Development work is performed on the Lenovo laptop.
2. Project directories are accessed through SSHFS mounts.
3. Source code modifications are saved directly to the original repositories on the main Ubuntu computer.
4. Applications are launched and tested on the main computer to ensure compatibility with its actual operating system, dependencies, and runtime environment.
5. Test results, logs, and runtime errors are reviewed to guide subsequent development.

### Important Development Requirements

- The Lenovo must be treated as the development workstation.
- The main computer must remain the authoritative location of project source files.
- Do not create unnecessary duplicate project repositories.
- Do not modify unrelated files on the main computer.
- Preserve existing project configurations and dependencies unless changes are required for functionality.
- Execute host-specific tests on the main Ubuntu computer rather than assuming successful execution on the Lenovo guarantees compatibility.
- Maintain the existing Git repository structures and version-control histories.

## Intended Outcome

The environment provides a separation between **code development** and **application execution**, allowing development tools and AI agents to operate from the Lenovo while the main Ubuntu computer retains the original project files and provides the target testing environment.



This architecture is intended to reduce unnecessary access to personal files, minimize development-related changes outside the selected projects, and maintain a consistent environment for developing and testing Media Viewer and Hermes Life.