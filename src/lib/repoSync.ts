/**
 * Repository Sync Module
 * Handles pushing data files to GitHub (rebuild triggers automatically on push)
 */

import { ContentTypeConfig, DEFAULT_CONTENT_TYPES } from './contentTypes';

export interface SyncResult {
  success: boolean;
  error?: string;
  commitSha?: string;
  commitUrl?: string;
  filesUpdated?: number;
}

const REPO_CONFIG = {
  owner: 'Ariyts',
  repo: 'openhub',
  branch: 'main',
  dataPath: 'src/data',
};

const DEFAULT_FILES = [
  { name: 'prompts.json', type: 'prompts' },
  { name: 'notes.json', type: 'notes' },
  { name: 'snippets.json', type: 'snippets' },
  { name: 'resources.json', type: 'resources' },
];

/**
 * Get the current file content and SHA
 */
async function getFileContent(
  token: string,
  path: string
): Promise<{ sha: string; content: string } | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/contents/${path}?ref=${REPO_CONFIG.branch}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      const content = decodeURIComponent(escape(atob(data.content)));
      return { sha: data.sha, content };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create a blob for a file
 */
async function createBlob(
  token: string,
  content: string
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/git/blobs`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          content,
          encoding: 'utf-8',
        }),
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.sha;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the reference for a branch
 */
async function getBranchRef(
  token: string
): Promise<{ commitSha: string; treeSha: string } | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/git/refs/heads/${REPO_CONFIG.branch}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      return { commitSha: data.object.sha, treeSha: '' };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get tree SHA from a commit
 */
async function getCommitTree(
  token: string,
  commitSha: string
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/git/commits/${commitSha}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.tree.sha;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the tree for src/data directory
 */
async function getDirectoryTree(
  token: string,
  treeSha: string
): Promise<{ sha: string; path: string }[]> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/git/trees/${treeSha}?recursive=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.tree
        .filter((item: { path: string; type: string }) => 
          item.path.startsWith('src/data/') && item.type === 'blob'
        )
        .map((item: { sha: string; path: string }) => ({
          sha: item.sha,
          path: item.path.replace('src/data/', ''),
        }));
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Create a new tree with updated files
 */
async function createTree(
  token: string,
  baseTreeSha: string,
  files: { path: string; blobSha: string }[]
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/git/trees`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: files.map((f) => ({
            path: `src/data/${f.path}`,
            mode: '100644',
            type: 'blob',
            sha: f.blobSha,
          })),
        }),
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.sha;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create a commit
 */
async function createCommit(
  token: string,
  message: string,
  treeSha: string,
  parentSha: string
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/git/commits`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          message,
          tree: treeSha,
          parents: [parentSha],
        }),
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.sha;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Update branch reference
 */
async function updateBranchRef(
  token: string,
  commitSha: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/git/refs/heads/${REPO_CONFIG.branch}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          sha: commitSha,
        }),
      }
    );

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Main sync function - push all data files in ONE commit
 * Includes both default files and custom content types
 */
export async function syncToRepository(
  data: {
    prompts: unknown[];
    notes: unknown[];
    snippets: unknown[];
    resources: unknown[];
    contentTypes?: ContentTypeConfig[];
  },
  token: string,
  onProgress?: (status: string) => void
): Promise<SyncResult> {
  onProgress?.('Preparing files...');

  // Get current branch state
  const branchRef = await getBranchRef(token);
  if (!branchRef) {
    return { success: false, error: 'Failed to get branch reference' };
  }

  // Get the tree SHA from the latest commit
  const baseTreeSha = await getCommitTree(token, branchRef.commitSha);
  if (!baseTreeSha) {
    return { success: false, error: 'Failed to get commit tree' };
  }

  // Get existing file SHAs
  const existingFiles = await getDirectoryTree(token, baseTreeSha);
  const existingShaMap = new Map(existingFiles.map((f) => [f.path, f.sha]));

  // Prepare files to commit
  const filesToCommit: { path: string; blobSha: string }[] = [];
  let filesUpdated = 0;

  // Process default files
  for (const file of DEFAULT_FILES) {
    onProgress?.(`Checking ${file.name}...`);

    const newContent = JSON.stringify(data[file.type as keyof typeof data], null, 2);
    const existingFile = existingShaMap.get(file.name);

    const blobSha = await createBlob(token, newContent);
    if (!blobSha) {
      return { success: false, error: `Failed to create blob for ${file.name}` };
    }

    if (existingFile && existingFile === blobSha) {
      continue;
    }

    filesToCommit.push({ path: file.name, blobSha });
    filesUpdated++;
  }

  // Process content types
  if (data.contentTypes && data.contentTypes.length > 0) {
    onProgress?.('Checking content-types.json...');

    // Get custom content types (not default ones)
    const defaultIds = DEFAULT_CONTENT_TYPES.map(t => t.id);
    const customTypes = data.contentTypes.filter(t => !defaultIds.includes(t.id));

    // Save all content types config
    const contentTypesContent = JSON.stringify(data.contentTypes, null, 2);
    const contentTypesBlobSha = await createBlob(token, contentTypesContent);
    
    if (contentTypesBlobSha) {
      const existingContentTypes = existingShaMap.get('content-types.json');
      if (!existingContentTypes || existingContentTypes !== contentTypesBlobSha) {
        filesToCommit.push({ path: 'content-types.json', blobSha: contentTypesBlobSha });
        filesUpdated++;
      }
    }

    // Create empty data files for custom content types
    for (const customType of customTypes) {
      const filename = `${customType.id}.json`;
      onProgress?.(`Creating ${filename}...`);

      const emptyContent = '[]'; // Empty array for new content type
      const blobSha = await createBlob(token, emptyContent);
      
      if (blobSha) {
        const existingFile = existingShaMap.get(filename);
        if (!existingFile || existingFile !== blobSha) {
          filesToCommit.push({ path: filename, blobSha });
        }
      }
    }
  }

  // If nothing changed, return success without creating commit
  if (filesToCommit.length === 0) {
    onProgress?.('No changes to commit');
    return {
      success: true,
      filesUpdated: 0,
      commitSha: branchRef.commitSha,
      commitUrl: `https://github.com/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/commit/${branchRef.commitSha}`,
    };
  }

  onProgress?.(`Creating commit with ${filesToCommit.length} file(s)...`);

  // Create new tree
  const newTreeSha = await createTree(token, baseTreeSha, filesToCommit);
  if (!newTreeSha) {
    return { success: false, error: 'Failed to create tree' };
  }

  // Create commit
  const timestamp = new Date().toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const commitMessage = `Update data - ${timestamp}`;

  const newCommitSha = await createCommit(
    token,
    commitMessage,
    newTreeSha,
    branchRef.commitSha
  );
  if (!newCommitSha) {
    return { success: false, error: 'Failed to create commit' };
  }

  onProgress?.('Updating branch...');

  // Update branch reference
  const updated = await updateBranchRef(token, newCommitSha);
  if (!updated) {
    return { success: false, error: 'Failed to update branch' };
  }

  return {
    success: true,
    commitSha: newCommitSha,
    commitUrl: `https://github.com/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/commit/${newCommitSha}`,
    filesUpdated,
  };
}

/**
 * Validate GitHub token has required permissions
 */
export async function validateToken(token: string): Promise<{
  valid: boolean;
  error?: string;
  user?: string;
}> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { valid: false, error: 'Invalid token' };
      }
      return { valid: false, error: `HTTP ${response.status}` };
    }

    const user = await response.json();

    // Check if user has write access to the repo
    const repoResponse = await fetch(
      `https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (repoResponse.ok) {
      const repoData = await repoResponse.json();
      if (!repoData.permissions?.push) {
        return { valid: false, error: 'No write access to repository' };
      }
    }

    return { valid: true, user: user.login };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return { valid: false, error: errorMessage };
  }
}

/**
 * Get repository info
 */
export function getRepoInfo() {
  return {
    owner: REPO_CONFIG.owner,
    repo: REPO_CONFIG.repo,
    branch: REPO_CONFIG.branch,
    url: `https://github.com/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}`,
    actionsUrl: `https://github.com/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/actions`,
  };
}
