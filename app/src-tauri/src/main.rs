#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use anyhow::{anyhow, Context, Result};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

// ---------- Data model ----------

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct Todo {
    pub text: String,
    #[serde(default)]
    pub done: bool,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct Artifact {
    pub name: String,
    /// "file" or "link"
    pub kind: String,
    /// For files: a path relative to the project folder (e.g. "artifacts/foo.csv").
    /// For links: a URL.
    pub target: String,
    #[serde(default)]
    pub added: String,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct Frontmatter {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub updated: String,
    #[serde(default)]
    pub todos: Vec<Todo>,
    #[serde(default)]
    pub artifacts: Vec<Artifact>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct Entry {
    /// Heading text, e.g. "2026-05-27 — Cleaned the data"
    pub heading: String,
    /// Body (markdown) below the heading.
    pub body: String,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct Project {
    /// Folder name (kebab-case slug).
    pub slug: String,
    pub meta: Frontmatter,
    pub entries: Vec<Entry>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ProjectSummary {
    pub slug: String,
    pub title: String,
    pub updated: String,
    pub entry_count: usize,
    pub todo_count: usize,
    pub todo_done: usize,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct AppConfig {
    #[serde(default)]
    pub root: String,
}

// ---------- Helpers ----------

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn now_stamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M").to_string()
}

fn slugify(name: &str) -> String {
    let s: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let mut out = String::new();
    let mut last_dash = false;
    for c in s.chars() {
        if c == '-' {
            if !last_dash && !out.is_empty() {
                out.push('-');
                last_dash = true;
            }
        } else {
            out.push(c);
            last_dash = false;
        }
    }
    out.trim_matches('-').to_string()
}

fn config_path() -> Result<PathBuf> {
    let dir = dirs::config_dir()
        .ok_or_else(|| anyhow!("no config dir"))?
        .join("data-diary");
    fs::create_dir_all(&dir).ok();
    Ok(dir.join("config.json"))
}

fn read_config() -> AppConfig {
    let path = match config_path() {
        Ok(p) => p,
        Err(_) => return AppConfig::default(),
    };
    if !path.exists() {
        return AppConfig::default();
    }
    let text = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&text).unwrap_or_default()
}

fn write_config(cfg: &AppConfig) -> Result<()> {
    let path = config_path()?;
    let text = serde_json::to_string_pretty(cfg)?;
    fs::write(path, text)?;
    Ok(())
}

fn project_dir(root: &str, slug: &str) -> PathBuf {
    Path::new(root).join(slug)
}

fn project_file(root: &str, slug: &str) -> PathBuf {
    project_dir(root, slug).join("project.Rmd")
}

fn artifacts_dir(root: &str, slug: &str) -> PathBuf {
    project_dir(root, slug).join("artifacts")
}

// ---------- RMD (de)serialization ----------

fn parse_rmd(text: &str, slug: &str) -> Result<Project> {
    // Expect "---\n<yaml>\n---\n<body>"
    let (fm, body) = if let Some(stripped) = text.strip_prefix("---\n") {
        if let Some(idx) = stripped.find("\n---") {
            let yaml = &stripped[..idx];
            let rest = &stripped[idx + 4..]; // skip "\n---"
            let rest = rest.trim_start_matches('\n');
            (yaml.to_string(), rest.to_string())
        } else {
            (String::new(), stripped.to_string())
        }
    } else {
        (String::new(), text.to_string())
    };

    let meta: Frontmatter = if fm.trim().is_empty() {
        Frontmatter::default()
    } else {
        serde_yaml::from_str(&fm).context("parsing YAML frontmatter")?
    };

    let entries = split_entries(&body);
    Ok(Project {
        slug: slug.to_string(),
        meta,
        entries,
    })
}

/// Split markdown body into sub-entries by `## ` headings.
/// `# ` (H1) and `## ` lines are only treated as structural when they are
/// OUTSIDE a fenced code block (``` or ~~~), so R comments inside code
/// fences are preserved verbatim.
fn split_entries(body: &str) -> Vec<Entry> {
    let mut entries: Vec<Entry> = Vec::new();
    let mut current_heading: Option<String> = None;
    let mut current_body: Vec<&str> = Vec::new();
    let mut in_fence = false;
    let mut fence_marker: &str = "";

    for line in body.lines() {
        let trimmed = line.trim_start();
        // Detect fence open/close. Treat ``` or ~~~ (3+) as a fence delimiter
        // when it appears at the start of a (possibly indented) line.
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let marker = if trimmed.starts_with("```") { "```" } else { "~~~" };
            if !in_fence {
                in_fence = true;
                fence_marker = marker;
            } else if trimmed.starts_with(fence_marker) {
                in_fence = false;
                fence_marker = "";
            }
            current_body.push(line);
            continue;
        }
        if in_fence {
            current_body.push(line);
            continue;
        }
        // Outside any code fence: handle structural headings.
        if line.starts_with("# ") {
            // Title H1 — emitted by the serializer from YAML; drop on parse.
            continue;
        }
        if let Some(rest) = line.strip_prefix("## ") {
            if current_heading.is_some() || !current_body.is_empty() {
                entries.push(Entry {
                    heading: current_heading.take().unwrap_or_default(),
                    body: current_body.join("\n").trim().to_string(),
                });
                current_body.clear();
            }
            current_heading = Some(rest.trim().to_string());
        } else {
            current_body.push(line);
        }
    }
    if current_heading.is_some() || !current_body.is_empty() {
        entries.push(Entry {
            heading: current_heading.unwrap_or_default(),
            body: current_body.join("\n").trim().to_string(),
        });
    }
    // Drop empty-heading + empty-body shells (the gap between H1 and first ##).
    entries.retain(|e| !(e.heading.is_empty() && e.body.trim().is_empty()));
    entries
}

fn serialize_rmd(project: &Project) -> Result<String> {
    let yaml = serde_yaml::to_string(&project.meta).context("writing YAML")?;
    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&yaml);
    if !yaml.ends_with('\n') {
        out.push('\n');
    }
    out.push_str("---\n\n");
    // H1 with title
    out.push_str(&format!("# {}\n\n", project.meta.title));
    for entry in &project.entries {
        if !entry.heading.is_empty() {
            out.push_str(&format!("## {}\n\n", entry.heading));
        }
        out.push_str(entry.body.trim_end());
        out.push_str("\n\n");
    }
    Ok(out)
}

// ---------- Tauri commands ----------

#[tauri::command]
fn get_config() -> AppConfig {
    read_config()
}

#[tauri::command]
fn set_root(path: String) -> Result<AppConfig, String> {
    let cfg = AppConfig { root: path };
    write_config(&cfg).map_err(|e| e.to_string())?;
    fs::create_dir_all(&cfg.root).map_err(|e| e.to_string())?;
    Ok(cfg)
}

#[tauri::command]
fn list_projects(root: String) -> Result<Vec<ProjectSummary>, String> {
    let mut out = Vec::new();
    let dir = Path::new(&root);
    if !dir.exists() {
        return Ok(out);
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let slug = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if slug.starts_with('.') {
            continue;
        }
        let rmd = path.join("project.Rmd");
        if !rmd.exists() {
            continue;
        }
        let text = fs::read_to_string(&rmd).unwrap_or_default();
        if let Ok(p) = parse_rmd(&text, &slug) {
            let done = p.meta.todos.iter().filter(|t| t.done).count();
            out.push(ProjectSummary {
                slug: p.slug,
                title: if p.meta.title.is_empty() {
                    slug.clone()
                } else {
                    p.meta.title.clone()
                },
                updated: p.meta.updated.clone(),
                entry_count: p.entries.iter().filter(|e| !e.heading.is_empty()).count(),
                todo_count: p.meta.todos.len(),
                todo_done: done,
            });
        }
    }
    // Sort by updated DESC, then title ASC
    out.sort_by(|a, b| b.updated.cmp(&a.updated).then(a.title.cmp(&b.title)));
    Ok(out)
}

#[tauri::command]
fn create_project(root: String, title: String) -> Result<Project, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("title required".into());
    }
    let slug = slugify(&title);
    if slug.is_empty() {
        return Err("title must contain letters or numbers".into());
    }
    let dir = project_dir(&root, &slug);
    if dir.exists() {
        return Err(format!("a project named '{}' already exists", slug));
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(artifacts_dir(&root, &slug)).map_err(|e| e.to_string())?;

    let now = today();
    let project = Project {
        slug: slug.clone(),
        meta: Frontmatter {
            title,
            created: now.clone(),
            updated: now,
            todos: vec![],
            artifacts: vec![],
        },
        entries: vec![Entry {
            heading: format!("{} — first entry", now_stamp()),
            body: "Start writing here.\n".to_string(),
        }],
    };
    let text = serialize_rmd(&project).map_err(|e| e.to_string())?;
    fs::write(project_file(&root, &slug), text).map_err(|e| e.to_string())?;
    Ok(project)
}

#[tauri::command]
fn read_project(root: String, slug: String) -> Result<Project, String> {
    let path = project_file(&root, &slug);
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    parse_rmd(&text, &slug).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_project(root: String, mut project: Project) -> Result<Project, String> {
    project.meta.updated = today();
    if project.meta.created.is_empty() {
        project.meta.created = today();
    }
    let text = serialize_rmd(&project).map_err(|e| e.to_string())?;
    let dir = project_dir(&root, &project.slug);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(project_file(&root, &project.slug), text).map_err(|e| e.to_string())?;
    Ok(project)
}

#[tauri::command]
fn delete_project(root: String, slug: String) -> Result<(), String> {
    let dir = project_dir(&root, &slug);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn add_artifact_file(root: String, slug: String, src_path: String) -> Result<Artifact, String> {
    let src = Path::new(&src_path);
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "bad source filename".to_string())?
        .to_string();

    let dest_dir = artifacts_dir(&root, &slug);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    // Avoid clobbering — append (2), (3) if needed.
    let dest = unique_path(&dest_dir, &name);
    fs::copy(src, &dest).map_err(|e| format!("copy failed: {}", e))?;

    let final_name = dest
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&name)
        .to_string();

    Ok(Artifact {
        name: final_name.clone(),
        kind: "file".to_string(),
        target: format!("artifacts/{}", final_name),
        added: today(),
    })
}

fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let ext = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();
    for i in 2..1000 {
        let candidate = dir.join(format!("{} ({}){}", stem, i, ext));
        if !candidate.exists() {
            return candidate;
        }
    }
    p
}

#[tauri::command]
fn resolve_artifact_path(root: String, slug: String, target: String) -> String {
    // For files, target is relative to the project dir. For links, target is the URL.
    if target.starts_with("http://") || target.starts_with("https://") {
        return target;
    }
    project_dir(&root, &slug)
        .join(target)
        .to_string_lossy()
        .to_string()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_root,
            list_projects,
            create_project,
            read_project,
            save_project,
            delete_project,
            add_artifact_file,
            resolve_artifact_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running data-diary application");
}
