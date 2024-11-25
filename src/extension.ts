import * as vscode from 'vscode';
import simpleGit from 'simple-git';
import * as path from 'path';

const git = simpleGit();

export function activate(context: vscode.ExtensionContext) {
    console.log('Your extension "git-commit-push" is now active!');
	let checkoutAllCommand = vscode.commands.registerCommand('submodule-helper.checkoutAll', async () => {
        try {
			const repoPath = vscode.workspace.rootPath || '';
			if (repoPath) {
				var branchName = await checkOutMainRepo(repoPath);
				if (branchName !== undefined) {
					vscode.window.showInformationMessage(branchName);
					await checkoutBranchForSubmodules(repoPath, branchName);
				}
			}
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error: ${error.message}`);
		}
    });
    let commitAllCommand = vscode.commands.registerCommand('submodule-helper.commitAll', async () => {
        const message = await vscode.window.showInputBox({ prompt: 'Enter commit message' });

		if (message === undefined) {
			return;
		}

        if (message) {
            try {
                const repoPath = vscode.workspace.rootPath || '';
                if (repoPath) {
                    await commitSubmodules(repoPath, message);
                    await commitMainRepo(repoPath, message);
                    vscode.window.showInformationMessage('Commit and push completed!');
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Error: ${error.message}`);
            }
        } else {
            vscode.window.showErrorMessage('No commit message entered');
        }
    });
	let pushAllCommand = vscode.commands.registerCommand('submodule-helper.pushAll', async () => {
        try {
			const repoPath = vscode.workspace.rootPath || '';
			if (repoPath) {
				await pushSubmodules(repoPath);
				await pushMainRepo(repoPath);
				vscode.window.showInformationMessage('Commit and push completed!');
			}
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error: ${error.message}`);
		}
    });

    context.subscriptions.push(commitAllCommand, pushAllCommand, checkoutAllCommand);
}

async function commitSubmodules(repoPath: string, message: string) {
    const submoduleDirs = await getSubmoduleDirs(repoPath);
    
    for (const dir of submoduleDirs) {
        try {
            const submoduleGit = simpleGit(dir);
            const status = await submoduleGit.status();
            if (status.files.length > 0 || status.staged.length > 0) {
                await submoduleGit.add('./*');
                await submoduleGit.commit(message);
            }
        } catch (err) {
            console.log(`No changes in submodule at ${dir}`);
        }
    }
}

async function commitMainRepo(repoPath: string, message: string) {
    const mainRepoGit = simpleGit(repoPath);
    const status = await mainRepoGit.status();
    if (status.files.length > 0) {
        await mainRepoGit.add('./*');
        await mainRepoGit.commit(message);
    }
}
async function pushSubmodules(repoPath: string) {
    const submoduleDirs = await getSubmoduleDirs(repoPath);
    
    for (const dir of submoduleDirs) {
        try {
            const submoduleGit = simpleGit(dir);
            const status = await submoduleGit.status();
            if (status.behind > 0) {
                await submoduleGit.pull();
            }
            if (status.ahead > 0) {
                await submoduleGit.push();
            }
        } catch (err) {
            console.log(`No changes in submodule at ${dir}`);
        }
    }
}
async function pushMainRepo(repoPath: string) {
    const mainRepoGit = simpleGit(repoPath);
    const status = await mainRepoGit.status();
    if (status.behind > 0) {
        await mainRepoGit.pull();
    }
    if (status.ahead > 0) {
        await mainRepoGit.push();
    }
}
async function getSubmoduleDirs(repoPath: string): Promise<string[]> {
    const gitInstance = simpleGit(repoPath);
    const submoduleStatus = await gitInstance.subModule(['status']);
    return submoduleStatus.split('\n')
        .filter(line => !!line.trim())
        .map(line => path.join(repoPath, line.split(' ')[2].trim()));
}
async function checkoutBranchForSubmodules(
    repoPath: string,
    branchName: string
): Promise<void> {
    const mainRepoGit = simpleGit(repoPath);

    // Fetch all submodules to ensure they are up-to-date
    // await mainRepoGit.submoduleUpdate(['--init', '--remote']);

    // Lấy danh sách các submodule
    const submodules = await mainRepoGit.subModule(['status']);
    const submodulePaths = submodules
        .split('\n')
        .map(line => line.trim().split(' ')[1])
        .filter(Boolean);

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Checking out or creating branch '${branchName}' in submodules`,
            cancellable: false,
        },
        async (progress) => {
            const total = submodulePaths.length;
            for (const [index, submodulePath] of submodulePaths.entries()) {
                const submoduleFullPath = `${repoPath}/${submodulePath}`;
                const submoduleGit = simpleGit(submoduleFullPath);

                try {
                    progress.report({
                        message: `Processing submodule: ${submodulePath} (${index + 1}/${total})`,
                        increment: (1 / total) * 100,
                    });

                    // Fetch branches for the submodule
                    await submoduleGit.fetch();

                    // Check if the branch exists locally or remotely
                    const branches = await submoduleGit.branch(['-a']);
                    const isRemoteBranch = branches.all.includes(`remotes/origin/${branchName}`);
                    const isLocalBranch = branches.all.includes(branchName);

                    if (isLocalBranch) {
                        // If the branch exists locally, checkout
                        await submoduleGit.checkout(branchName);
                        vscode.window.showInformationMessage(`Checked out local branch '${branchName}' in submodule '${submodulePath}'`);
                    } else if (isRemoteBranch) {
                        // If the branch exists remotely, create and checkout local branch
                        await submoduleGit.checkoutBranch(branchName, `origin/${branchName}`);
                        vscode.window.showInformationMessage(`Checked out remote branch '${branchName}' in submodule '${submodulePath}'`);
                    } else {
                        // Branch doesn't exist, create a new branch
                        const defaultBranch = (await submoduleGit.branchLocal()).current || 'main';
                        await submoduleGit.checkoutLocalBranch(branchName);
                        vscode.window.showInformationMessage(
                            `Created and checked out new branch '${branchName}' in submodule '${submodulePath}' from '${defaultBranch}'`
                        );
                    }
                } catch (error: any) {
                    vscode.window.showErrorMessage(
                        `Failed to checkout or create branch '${branchName}' in submodule '${submodulePath}': ${error.message}`
                    );
                }
            }
        }
    );
}
async function checkOutMainRepo(repoPath: string): Promise<string | undefined> {
    const mainRepoGit = simpleGit(repoPath);
    const branches = await mainRepoGit.branch(['-a']);
    const branchList = branches.all;

    const picker = vscode.window.createQuickPick();
    picker.items = branchList.map(branch => ({ label: branch }));
    picker.placeholder = 'Type to filter and select a branch';
    picker.matchOnDescription = true;
    picker.matchOnDetail = true;

    picker.onDidChangeValue(value => {
        const filteredBranches = branchList.filter(branch =>
            branch.toLowerCase().includes(value.toLowerCase())
        );
        picker.items = filteredBranches.map(branch => ({ label: branch }));
    });

    picker.show();
	let isAccepted = false;
    return new Promise((resolve) => {
        picker.onDidAccept(async () => {
			isAccepted = true;
            const selectedBranch = picker.selectedItems[0]?.label;

            if (selectedBranch) {
                try {
                    await mainRepoGit.checkout(selectedBranch); // Thực hiện checkout
                    vscode.window.showInformationMessage(`Checked out branch: ${selectedBranch}`);
                    resolve(selectedBranch);
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to checkout branch ${selectedBranch}: ${error.message}`);
                    resolve(undefined);
                }
            } else {
                resolve(undefined);
            }
            picker.hide();
        });

        picker.onDidHide(() => {
			picker.dispose();
			if (!isAccepted) {
				resolve(undefined);
			}
        });
    });
}

export function deactivate() {}