import { useEffect, useState } from 'react';
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Dropdown,
    Field,
    MessageBar,
    MessageBarBody,
    MessageBarTitle,
    Option,
    Radio,
    RadioGroup,
    Spinner,
    Text,
    makeStyles,
    tokens,
} from '@fluentui/react-components';
import { CopyRegular } from '@fluentui/react-icons';
import { useConfig } from '../../state/ConfigContext';
import {
    dataverseAppService,
    type AppSummary,
} from '../../services/dataverseAppService';
import {
    dataverseThemeScopeService,
    THEME_SETTING_DISPLAY_NAMES,
    type SettingDefinitionRef,
    type ThemeSettingKind,
} from '../../services/dataverseThemeScopeService';
import { BusyButton } from '../common/BusyButton';

const useStyles = makeStyles({
    body: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
    hint: {
        color: tokens.colorNeutralForeground3,
    },
    row: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
    },
});

export interface ScopeDialogProps {
    open: boolean;
    onDismiss: () => void;
    /** Unique name of the saved theme web resource — the value of the setting. */
    webResourceName?: string;
    /** Which setting the open document belongs to. */
    kind: ThemeSettingKind;
    mountNode?: HTMLElement;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function notifySuccess(title: string, body: string) {
    try {
        await window.toolboxAPI.utils.showNotification({
            title,
            body,
            type: 'success',
        });
    } catch (error) {
        console.error('Unable to show a notification:', error);
    }
}

/**
 * Assigns the theme to the whole environment or to a single app entirely via
 * the Dataverse API (docs/IMPLEMENTATION_PLAN.md §2.4).
 *
 * When the setting definition is not yet visible through the background
 * discovery, Apply re-runs discovery inline and then calls
 * `AddSolutionComponent` to add it to the selected solution before writing the
 * setting value — replicating the "Add existing → More → Setting" maker-portal
 * flow without requiring the user to leave the tool.
 */
export function ScopeDialog({
    open,
    onDismiss,
    webResourceName,
    kind,
    mountNode,
}: ScopeDialogProps) {
    const styles = useStyles();
    const { connection, scope, scopeLoading, selectedSolution } = useConfig();

    const [target, setTarget] = useState<'environment' | 'app'>('environment');
    const [apps, setApps] = useState<AppSummary[]>([]);
    const [appsLoading, setAppsLoading] = useState(false);
    const [appId, setAppId] = useState<string | undefined>();
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<string | undefined>();
    const [error, setError] = useState<string | undefined>();
    const [conflict, setConflict] = useState(false);

    const definition = scope?.definitions[kind];
    const otherKind: ThemeSettingKind =
        kind === 'customTheme' ? 'appHeaderColorsOnly' : 'customTheme';
    const otherDefinition = scope?.definitions[otherKind];

    useEffect(() => {
        if (!open || !connection) {
            return;
        }
        setError(undefined);
        setAppsLoading(true);
        let cancelled = false;

        void (async () => {
            try {
                const loaded = await dataverseAppService.listApps();
                if (!cancelled) {
                    setApps(loaded);
                }
            } catch (loadError) {
                if (!cancelled) {
                    setError(message(loadError));
                }
            } finally {
                if (!cancelled) {
                    setAppsLoading(false);
                }
            }

            // "Override app header color" is ignored whenever a custom theme
            // definition is set — the tool must say so (§2.4).
            if (otherDefinition) {
                const assignment =
                    await dataverseThemeScopeService.readScopeAssignment(
                        otherDefinition,
                        otherKind
                    );
                const inUse =
                    Boolean(assignment.environmentValue) ||
                    Object.keys(assignment.appValues).length > 0;
                if (!cancelled) {
                    setConflict(inUse);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [open, connection, otherDefinition, otherKind]);

    const handleApply = async () => {
        if (!webResourceName) {
            return;
        }
        setBusy(true);
        setError(undefined);
        setProgress(undefined);

        try {
            // Use the pre-discovered definition when available; otherwise
            // re-run discovery inline so the user doesn't have to close and
            // reopen the dialog just because the background probe ran before
            // the setting was visible in this environment.
            let activeDefinition: SettingDefinitionRef | undefined = definition;
            if (!activeDefinition) {
                setProgress('Discovering the setting definition…');
                const freshCapabilities =
                    await dataverseThemeScopeService.discoverScopeCapabilities();
                activeDefinition = freshCapabilities.definitions[kind];
                if (!activeDefinition) {
                    throw new Error(
                        `The "${THEME_SETTING_DISPLAY_NAMES[kind]}" setting definition could not be found in this environment. ` +
                            `The feature may not be available in this version of Power Platform.`
                    );
                }
            }

            // Add the setting definition to the selected solution — this is the
            // API equivalent of "Add existing → More → Setting" in the maker
            // portal.  Failure is non-fatal (see addDefinitionToSolution).
            if (selectedSolution) {
                setProgress(
                    `Adding the setting to solution "${selectedSolution.friendlyName}"…`
                );
                await dataverseThemeScopeService.addDefinitionToSolution(
                    activeDefinition.id,
                    selectedSolution.uniqueName
                );
            }

            if (target === 'environment') {
                setProgress('Writing the environment-wide setting value…');
                await dataverseThemeScopeService.setEnvironmentScope(
                    activeDefinition,
                    webResourceName
                );
                await notifySuccess(
                    'Theme applied',
                    `"${THEME_SETTING_DISPLAY_NAMES[kind]}" is now set to ${webResourceName} for the whole environment.`
                );
                onDismiss();
            } else if (appId) {
                setProgress('Writing the per-app setting value…');
                await dataverseThemeScopeService.setAppScope(
                    activeDefinition,
                    appId,
                    webResourceName
                );
                await notifySuccess(
                    'Theme applied',
                    `"${THEME_SETTING_DISPLAY_NAMES[kind]}" is now set to ${webResourceName} for the selected app.`
                );
                onDismiss();
            } else {
                throw new Error('Select the app the theme should apply to.');
            }
        } catch (applyError) {
            setError(message(applyError));
        } finally {
            setBusy(false);
            setProgress(undefined);
        }
    };

    const handleCopyName = async () => {
        if (webResourceName) {
            await window.toolboxAPI.utils
                .copyToClipboard(webResourceName)
                .catch(() => undefined);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(_, data) =>
                data.open || busy ? undefined : onDismiss()
            }
        >
            <DialogSurface mountNode={mountNode}>
                <DialogBody>
                    <DialogTitle>Apply the theme</DialogTitle>
                    <DialogContent className={styles.body}>
                        {!webResourceName && (
                            <MessageBar intent="warning">
                                <MessageBarBody>
                                    Save the theme to a web resource first — the
                                    setting stores its unique name.
                                </MessageBarBody>
                            </MessageBar>
                        )}

                        {webResourceName && (
                            <div className={styles.row}>
                                <Text size={200}>
                                    Setting{' '}
                                    <strong>
                                        {THEME_SETTING_DISPLAY_NAMES[kind]}
                                    </strong>{' '}
                                    = <strong>{webResourceName}</strong>
                                </Text>
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<CopyRegular />}
                                    onClick={handleCopyName}
                                >
                                    Copy name
                                </Button>
                            </div>
                        )}

                        {conflict && (
                            <MessageBar intent="warning">
                                <MessageBarBody>
                                    <MessageBarTitle>
                                        Both theme settings are configured
                                    </MessageBarTitle>
                                    "Override app header color" is ignored by
                                    the platform whenever "Custom theme
                                    definition" is set.
                                </MessageBarBody>
                            </MessageBar>
                        )}

                        {scopeLoading && (
                            <Spinner
                                size="tiny"
                                label="Checking what this environment supports…"
                            />
                        )}

                        <Field label="Scope">
                            <RadioGroup
                                value={target}
                                onChange={(_, data) =>
                                    setTarget(
                                        data.value as 'environment' | 'app'
                                    )
                                }
                            >
                                <Radio
                                    value="environment"
                                    label="The whole environment"
                                />
                                <Radio
                                    value="app"
                                    label="A single model-driven app"
                                />
                            </RadioGroup>
                        </Field>

                        {target === 'app' && (
                            <Field label="App" required>
                                <Dropdown
                                    mountNode={mountNode}
                                    disabled={appsLoading}
                                    placeholder={
                                        appsLoading
                                            ? 'Loading apps…'
                                            : 'Select an app'
                                    }
                                    value={
                                        apps.find((app) => app.id === appId)
                                            ?.name ?? ''
                                    }
                                    selectedOptions={appId ? [appId] : []}
                                    onOptionSelect={(_, data) =>
                                        setAppId(data.optionValue)
                                    }
                                >
                                    {apps.map((app) => (
                                        <Option
                                            key={app.id}
                                            value={app.id}
                                            text={app.name}
                                        >
                                            {app.name}
                                        </Option>
                                    ))}
                                </Dropdown>
                            </Field>
                        )}

                        {error && (
                            <MessageBar intent="error">
                                <MessageBarBody>{error}</MessageBarBody>
                            </MessageBar>
                        )}

                        {busy && (
                            <Spinner
                                size="tiny"
                                labelPosition="after"
                                label={
                                    progress ??
                                    'Applying the theme in Dataverse…'
                                }
                            />
                        )}

                        <Text size={100} className={styles.hint}>
                            The theme settings are not covered by Microsoft's
                            documented entity reference; the tool resolves them
                            at runtime and never hardcodes ids.
                        </Text>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="secondary"
                            disabled={busy}
                            onClick={onDismiss}
                        >
                            Close
                        </Button>
                        <BusyButton
                            appearance="primary"
                            busy={busy}
                            busyLabel="Applying…"
                            disabled={
                                !webResourceName || (target === 'app' && !appId)
                            }
                            onClick={handleApply}
                        >
                            Apply
                        </BusyButton>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
