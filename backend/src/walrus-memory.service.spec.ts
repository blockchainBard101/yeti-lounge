import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WalrusMemoryService } from './walrus-memory.service';

describe('WalrusMemoryService', () => {
  let service: WalrusMemoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalrusMemoryService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'MEMWAL_PRIVATE_KEY') return 'placeholder_private_key';
              if (key === 'MEMWAL_ACCOUNT_ID') return '0xa07fef847e38ac47e4af9b76e70021e971fb6840317f8c3030b463bf7a5d0a7d';
              if (key === 'MEMWAL_SERVER_URL') return 'https://relayer.memory.walrus.xyz';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WalrusMemoryService>(WalrusMemoryService);
    await module.init();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should fallback to mock mode if private key is a placeholder', () => {
    expect(service.isMockMode()).toBe(true);
    expect(service.getMemWalClient()).toBeNull();
  });

  it('should store and recall memories correctly in mock mode', async () => {
    const text1 = "User prefers dark mode and typescript";
    const text2 = "Yeti mascot name is Lofi";

    await service.remember(text1);
    await service.remember(text2);

    const matchesPreferences = await service.recall("preferences");
    expect(matchesPreferences.length).toBeGreaterThan(0);
    expect(matchesPreferences[0].text).toContain("prefers dark mode");

    const matchesName = await service.recall("mascot name");
    expect(matchesName.length).toBeGreaterThan(0);
    expect(matchesName[0].text).toContain("Lofi");

    const matchesNone = await service.recall("extraneous queries");
    expect(matchesNone.length).toBe(0);
  });
});
