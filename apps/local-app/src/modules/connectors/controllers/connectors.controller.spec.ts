import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from '../services/connectors.service';
import { TaskimAdapter } from '../adapters/taskim.adapter';

describe('ConnectorsController', () => {
  let controller: ConnectorsController;
  let service: { list: jest.Mock; get: jest.Mock; create: jest.Mock };
  let taskim: {
    listWorkspaces: jest.Mock;
    listProjects: jest.Mock;
    createWorkspace: jest.Mock;
    createProject: jest.Mock;
  };

  beforeEach(async () => {
    service = { list: jest.fn(), get: jest.fn(), create: jest.fn() };
    taskim = {
      listWorkspaces: jest.fn(),
      listProjects: jest.fn(),
      createWorkspace: jest.fn(),
      createProject: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectorsController],
      providers: [
        { provide: ConnectorsService, useValue: service },
        { provide: TaskimAdapter, useValue: taskim },
      ],
    }).compile();
    controller = module.get(ConnectorsController);
  });

  it('previewWorkspaces delegates to adapter.listWorkspaces with a transient config', async () => {
    taskim.listWorkspaces.mockResolvedValue([{ id: 'ws-1', name: 'Acme' }]);
    const result = await controller.previewWorkspaces({ apiUrl: 'http://t.local', apiKey: 'k' });
    expect(taskim.listWorkspaces).toHaveBeenCalledWith({
      apiUrl: 'http://t.local',
      credentials: { token: 'k' },
    });
    expect(result).toEqual([{ id: 'ws-1', name: 'Acme' }]);
  });

  it('previewProjects delegates to adapter.listProjects with workspaceId', async () => {
    taskim.listProjects.mockResolvedValue([{ id: 'p-1', name: 'B' }]);
    await controller.previewProjects({
      apiUrl: 'http://t.local',
      apiKey: 'k',
      workspaceId: 'ws-1',
    });
    expect(taskim.listProjects).toHaveBeenCalledWith({
      apiUrl: 'http://t.local',
      credentials: { token: 'k' },
      workspaceId: 'ws-1',
    });
  });

  it('create persists as-is when no new*Name given', async () => {
    service.create.mockResolvedValue({ id: 'c1' });
    await controller.create({
      projectId: '00000000-0000-0000-0000-000000000001',
      type: 'taskim',
      name: 'N',
      enabled: true,
      config: { apiUrl: 'http://t.local', credentials: { token: 'k' }, workspaceId: 'ws-1' },
      externalProjectId: 'pr-1',
    });
    expect(taskim.createWorkspace).not.toHaveBeenCalled();
    expect(taskim.createProject).not.toHaveBeenCalled();
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ workspaceId: 'ws-1' }),
        externalProjectId: 'pr-1',
      }),
    );
  });

  it('create resolves newWorkspaceName via adapter then persists the id', async () => {
    taskim.createWorkspace.mockResolvedValue({ id: 'ws-new', name: 'Fresh' });
    service.create.mockResolvedValue({ id: 'c1' });
    await controller.create({
      projectId: '00000000-0000-0000-0000-000000000001',
      type: 'taskim',
      name: 'N',
      enabled: true,
      config: { apiUrl: 'http://t.local', credentials: { token: 'k' } },
      newWorkspaceName: 'Fresh',
      externalProjectId: 'pr-1',
    });
    expect(taskim.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ apiUrl: 'http://t.local' }),
      'Fresh',
    );
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ workspaceId: 'ws-new' }),
      }),
    );
    // newWorkspaceName is stripped before persistence
    expect(service.create.mock.calls[0][0].newWorkspaceName).toBeUndefined();
  });

  it('create resolves newProjectName via adapter after workspace resolved', async () => {
    taskim.createProject.mockResolvedValue({ id: 'p-new', name: 'Board N' });
    service.create.mockResolvedValue({ id: 'c1' });
    await controller.create({
      projectId: '00000000-0000-0000-0000-000000000001',
      type: 'taskim',
      name: 'N',
      enabled: true,
      config: { apiUrl: 'http://t.local', credentials: { token: 'k' }, workspaceId: 'ws-1' },
      newProjectName: 'Board N',
    });
    expect(taskim.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' }),
      'Board N',
    );
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        externalProjectId: 'p-new',
      }),
    );
    // newProjectName is stripped before persistence
    expect(service.create.mock.calls[0][0].newProjectName).toBeUndefined();
  });

  it('rejects workspaceId + newWorkspaceName together', async () => {
    await expect(
      controller.create({
        projectId: '00000000-0000-0000-0000-000000000001',
        type: 'taskim',
        name: 'N',
        enabled: true,
        config: { apiUrl: 'http://t.local', credentials: { token: 'k' }, workspaceId: 'ws-1' },
        newWorkspaceName: 'Fresh',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
