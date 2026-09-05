import { Badge, Text, Title3, makeStyles, tokens } from '@fluentui/react-components';
import { version } from '../../../package.json';

const useStyles = makeStyles({
    header: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: tokens.spacingHorizontalM,
        padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
        borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    headerText: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minWidth: 0,
    },
    titleRow: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
    },
    headerIcon: {
        width: '48px',
        height: '48px',
        flexShrink: 0,
        display: 'block',
        marginTop: '2px',
    },
    version: {
        position: 'relative',
        top: tokens.spacingVerticalXS,
    },
    subtitle: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        display: 'block',
    },
});

/** The tool's own title bar: icon, name, version badge and one-line summary. */
export function StudioHeader() {
    const styles = useStyles();

    return (
        <div className={styles.header}>
            <img
                src="/icons/tool.svg"
                alt="Theme Studio icon"
                className={styles.headerIcon}
            />
            <div className={styles.headerText}>
                <div className={styles.titleRow}>
                    <Title3>Theme Studio</Title3>
                    <Badge
                        className={styles.version}
                        appearance="tint"
                        color="subtle"
                        size="small"
                    >
                        {`v${version}`}
                    </Badge>
                </div>
                <Text className={styles.subtitle}>
                    Configure model-driven app themes with a WYSIWYG preview
                </Text>
            </div>
        </div>
    );
}
