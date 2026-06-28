import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AutoAssignRulesController } from './auto-assign-rules.controller';
import { AutoAssignRulesService } from '../services/auto-assign-rules.service';

describe('AutoAssignRulesController', () => {
  let controller: AutoAssignRulesController;
  let service: {
    list: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    reorder: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      update: jest.fn().mockResolvedValue({ id: 'r1' }),
      delete: jest.fn().mockResolvedValue(undefined),
      reorder: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AutoAssignRulesController],
      providers: [{ provide: AutoAssignRulesService, useValue: service }],
    }).compile();
    controller = module.get(AutoAssignRulesController);
  });

  it('lists rules for a project', async () => {
    await controller.list('p1');
    expect(service.list).toHaveBeenCalledWith('p1');
  });

  it('creates a valid rule', async () => {
    const body = {
      matchType: 'status',
      statusId: 's1',
      tags: null,
      targetType: 'agent',
      targetAgentId: 'a1',
      targetTeamId: null,
      overrideExisting: false,
      enabled: true,
    };
    await controller.create('p1', body);
    expect(service.create).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ matchType: 'status' }),
    );
  });

  it('rejects a status rule missing statusId', async () => {
    await expect(
      controller.create('p1', {
        matchType: 'status',
        statusId: null,
        tags: null,
        targetType: 'agent',
        targetAgentId: 'a1',
        targetTeamId: null,
        overrideExisting: false,
        enabled: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a rule with both agent and team targets', async () => {
    await expect(
      controller.create('p1', {
        matchType: 'tag',
        statusId: null,
        tags: ['x'],
        targetType: 'agent',
        targetAgentId: 'a1',
        targetTeamId: 't1',
        overrideExisting: false,
        enabled: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates and deletes by id', async () => {
    await controller.update('r1', { enabled: false });
    expect(service.update).toHaveBeenCalledWith('r1', { enabled: false });
    await controller.delete('r1');
    expect(service.delete).toHaveBeenCalledWith('r1');
  });

  it('reorders', async () => {
    await controller.reorder('p1', { items: [{ id: 'r1', priority: 0 }] });
    expect(service.reorder).toHaveBeenCalledWith('p1', [{ id: 'r1', priority: 0 }]);
  });
});
