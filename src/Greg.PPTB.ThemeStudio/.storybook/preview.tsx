import { useRef, type ReactNode } from 'react';
import type { Preview } from '@storybook/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ToolboxAPIMock, DataverseAPIMock } from '@shko.online/pptb-mock';
import { ThemeProvider } from '../src/state/ThemeContext';
import { ConfigProvider } from '../src/state/ConfigContext';
import { PortalMountProvider } from '../src/state/PortalMountContext';
import solutionsMock from '../stories/mockData/solutions.json';
import appmodulesMock from '../stories/mockData/appmodules.json';
import settingdefinitionsMock from '../stories/mockData/settingdefinitions.json';
import webresourcesMock from '../stories/mockData/webresources.json';
import webresourceContentsMock from '../stories/mockData/webresourceContents.json';
import * as fakeDataverse from './fakeDataverse';
import '../src/index.css';
import { Connection } from '@pptb/types/toolboxAPI'

/** 1x1 transparent pixel, used for image web resources with no captured content. */
const PLACEHOLDER_PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PLACEHOLDER_SVG = btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><rect width="32" height="32" rx="4" fill="#8A8886"/></svg>'
);
const PLACEHOLDER_XML = btoa('<AppHeaderColors background="#0F1B2D" foreground="#FFFFFF"/>');

function webResourceContent(id: string, webresourcetype: number) {
    const captured = (webresourceContentsMock as Record<string, string>)[id];
    if (captured) {
        return captured;
    }
    if (webresourcetype === 4) {
        return PLACEHOLDER_XML;
    }
    return webresourcetype === 11 ? PLACEHOLDER_SVG : PLACEHOLDER_PNG;
}

const fakeDataverseReady = fakeDataverse.seedFakeDataverse({
    // The solution picker filters on columns the captured mock doesn't carry.
    solution: solutionsMock.map((solution) => ({
        ...solution,
        ismanaged: false,
        isvisible: true,
    })),
    appmodule: appmodulesMock,
    settingdefinition: settingdefinitionsMock,
    webresource: webresourcesMock.map((resource) => ({
        ...resource,
        content: webResourceContent(
            resource.webresourceid,
            resource.webresourcetype
        ),
    })),
});

// Initialize and set PPTB mocks as window/global variables using @shko.online/pptb-mock
export function initPPTBMocks() {
    if (!window.toolboxAPI) {
        const toolboxAPI = new ToolboxAPIMock();
        toolboxAPI.connections.getActiveConnection.callsFake(async () => ({
            id: 'mock-connection-id',
            name: 'betim-mvp-alm01',
            url: 'https://betim-mvp-alm01.crm4.dynamics.com',
            type: 'Dataverse',
            environment: 'Dev',
        } as Connection));
        toolboxAPI.utils.getCurrentTheme.callsFake(async () => 'light');
        toolboxAPI.utils.showNotification.callsFake(async () => {});
        toolboxAPI.settings.get.callsFake(async () => null);
        toolboxAPI.settings.set.callsFake(async () => {});
        toolboxAPI.events.on.callsFake(() => {});
        toolboxAPI.events.off.callsFake(() => {});
        window.toolboxAPI = toolboxAPI as unknown as typeof window.toolboxAPI;
    }

    if (!window.dataverseAPI) {
        const dataverseAPI = new DataverseAPIMock();
        dataverseAPI.queryData.callsFake(async (query: string) => {
            await fakeDataverseReady;
            return fakeDataverse.queryData(query);
        });
        dataverseAPI.retrieve.callsFake(async (entity: string, id: string) => {
            await fakeDataverseReady;
            return fakeDataverse.retrieve(entity, id);
        });
        dataverseAPI.create.callsFake(
            async (entity: string, payload: Record<string, unknown>) => {
                await fakeDataverseReady;
                return fakeDataverse.create(entity, payload);
            }
        );
        dataverseAPI.update.callsFake(
            async (
                entity: string,
                id: string,
                payload: Record<string, unknown>
            ) => {
                await fakeDataverseReady;
                return fakeDataverse.update(entity, id, payload);
            }
        );
        dataverseAPI.execute.callsFake(
            async (request: {
                operationName: string;
                parameters?: Record<string, unknown>;
            }) => {
                await fakeDataverseReady;
                return fakeDataverse.execute(request);
            }
        );
        dataverseAPI.getEntityRelatedMetadata.callsFake(
            async (entity: string, relationshipType: string) => {
                await fakeDataverseReady;
                return fakeDataverse.getEntityRelatedMetadata(
                    entity,
                    relationshipType
                );
            }
        );
        dataverseAPI.publishCustomizations.callsFake(async () => void 0);
        dataverseAPI.fetchXmlQuery.callsFake(async (fetchXml: string) => {
            await fakeDataverseReady;
            return fakeDataverse.fetchXmlQuery(fetchXml);
        });
        dataverseAPI.getSolutions.callsFake(async () => {
            await fakeDataverseReady;
            return fakeDataverse.queryData('solutions');
        });
        window.dataverseAPI = dataverseAPI as unknown as typeof window.dataverseAPI;
        // Escape hatch for stories/devs: `resetFakeDataverse()` in the console.
        (window as unknown as Record<string, unknown>).resetFakeDataverse =
            fakeDataverse.resetFakeDataverse;
    }
}

initPPTBMocks();

/** `parameters.fillViewport: false` lets a small story size itself to its content. */
function StoryDecorator({
    children,
    fillViewport,
}: {
    children: ReactNode;
    fillViewport: boolean;
}) {
    const portalMountRef = useRef<HTMLDivElement | null>(null);
    return (
        <FluentProvider theme={webLightTheme}>
            <div ref={portalMountRef} style={{ position: 'fixed', top: 0, left: 0, width: 0, height: 0, zIndex: 1000000 }} />
            <PortalMountProvider mountRef={portalMountRef}>
                <ThemeProvider>
                    <ConfigProvider>
                        <div
                            style={
                                fillViewport
                                    ? { height: '100vh', width: '100%' }
                                    : { width: '100%' }
                            }
                        >
                            {children}
                        </div>
                    </ConfigProvider>
                </ThemeProvider>
            </PortalMountProvider>
        </FluentProvider>
    );
}

const preview: Preview = {
    parameters: {
        docs: {
            canvas: {
                 sourceState: "none",
            },
        },
        controls: {
            matchers: {
                color: /(background|color)$/i,
                date: /Date$/i,
            },
        },
    },
    decorators: [
        (Story, context) => (
            <StoryDecorator
                fillViewport={context.parameters.fillViewport !== false}
            >
                <Story />
            </StoryDecorator>
        ),
    ],
};

export default preview;
